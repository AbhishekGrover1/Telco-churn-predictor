"""Telco churn predictor: a Flask API plus the static UI in ./static."""

import logging
import math
import os
from pathlib import Path

import joblib
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "telco_churn_pipeline.pkl"

HIGH_AT = 0.50    # the same cut-off the pipeline's own predict() uses
MEDIUM_AT = 0.30
MIN_GAIN = 0.03   # smallest drop in probability worth listing as a lever

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("churn")

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024  # a real request is well under 1 KB
CORS(app, resources={r"/(predict|health)": {"origins": os.getenv("ALLOWED_ORIGINS", "*").split(",")}})

model = joblib.load(MODEL_PATH)
FEATURES = list(model.feature_names_in_)
CHURN = list(model.classes_).index(1)

YES_NO = ("Yes", "No")
INTERNET_ADDONS = (
    "OnlineSecurity", "OnlineBackup", "DeviceProtection",
    "TechSupport", "StreamingTV", "StreamingMovies",
)

CATEGORICAL = {
    "gender": ("Female", "Male"),
    "Partner": YES_NO,
    "Dependents": YES_NO,
    "PhoneService": YES_NO,
    "MultipleLines": ("Yes", "No", "No phone service"),
    "InternetService": ("DSL", "Fiber optic", "No"),
    **{col: ("Yes", "No", "No internet service") for col in INTERNET_ADDONS},
    "Contract": ("Month-to-month", "One year", "Two year"),
    "PaperlessBilling": YES_NO,
    "PaymentMethod": (
        "Bank transfer (automatic)", "Credit card (automatic)",
        "Electronic check", "Mailed check",
    ),
}
NUMERIC = {
    "tenure": (0, 120),
    "MonthlyCharges": (0, 500),
    "TotalCharges": (0, 100_000),
}

# Single-field changes the what-if step tries. Add-ons only ever move to "Yes".
LEVERS = {
    "Contract": ("One year", "Two year"),
    "PaymentMethod": CATEGORICAL["PaymentMethod"],
    "PaperlessBilling": YES_NO,
    "OnlineSecurity": ("Yes",),
    "OnlineBackup": ("Yes",),
    "DeviceProtection": ("Yes",),
    "TechSupport": ("Yes",),
}

# Fail at boot, not on the first request, if the schema above drifts from the model.
_schema = set(CATEGORICAL) | set(NUMERIC) | {"SeniorCitizen"}
if set(FEATURES) != _schema:
    raise RuntimeError(f"Schema is out of sync with the model: {sorted(set(FEATURES) ^ _schema)}")


def validate(payload):
    clean, problems = {}, {}

    for name, (low, high) in NUMERIC.items():
        try:
            value = float(payload[name])
        except (KeyError, TypeError, ValueError):
            problems[name] = "Enter a number."
            continue
        if not math.isfinite(value) or not low <= value <= high:
            problems[name] = f"Must be between {low} and {high:,}."
        else:
            clean[name] = value

    for name, allowed in CATEGORICAL.items():
        value = payload.get(name)
        if value in allowed:
            clean[name] = value
        else:
            problems[name] = "Choose one of: " + ", ".join(allowed) + "."

    # The current pipeline drops this column, but it still expects it to be present.
    senior = payload.get("SeniorCitizen", 0)
    if senior in (0, 1, "0", "1", False, True):
        clean["SeniorCitizen"] = int(senior)
    else:
        problems["SeniorCitizen"] = "Must be 0 or 1."

    return clean, problems


def reconcile(record):
    """Keep dependent fields consistent with how they look in the training data."""
    if record["PhoneService"] == "No":
        record["MultipleLines"] = "No phone service"
    elif record["MultipleLines"] == "No phone service":
        record["MultipleLines"] = "No"

    no_internet = record["InternetService"] == "No"
    for col in INTERNET_ADDONS:
        if no_internet:
            record[col] = "No internet service"
        elif record[col] == "No internet service":
            record[col] = "No"
    return record


def risk_level(prob):
    if prob >= HIGH_AT:
        return "high"
    return "medium" if prob >= MEDIUM_AT else "low"


def what_if(record, base_prob):
    """Score the customer again with one field changed at a time, keep the best few."""
    variants, changes = [], []
    for field, options in LEVERS.items():
        if field in INTERNET_ADDONS and record["InternetService"] == "No":
            continue
        for option in options:
            if option != record[field]:
                variants.append({**record, field: option})
                changes.append((field, option))
    if not variants:
        return []

    probs = model.predict_proba(pd.DataFrame(variants, columns=FEATURES))[:, CHURN]

    best = {}
    for (field, option), prob in zip(changes, probs):
        delta = float(prob) - base_prob
        if field not in best or delta < best[field][1]:
            best[field] = (option, delta)

    ranked = sorted(
        ((field, option, delta) for field, (option, delta) in best.items() if delta <= -MIN_GAIN),
        key=lambda item: item[2],
    )
    return [
        {"field": field, "value": option, "delta": round(delta, 4)}
        for field, option, delta in ranked[:3]
    ]


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/health")
def health():
    return jsonify(status="ok", model=MODEL_PATH.name)


@app.post("/predict")
def predict():
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Send the customer as a JSON object."), 400

    record, problems = validate(payload)
    if problems:
        return jsonify(error="Some fields are invalid.", fields=problems), 422
    record = reconcile(record)

    try:
        row = pd.DataFrame([record], columns=FEATURES)
        prob = float(model.predict_proba(row)[0, CHURN])
        levers = what_if(record, prob)
    except Exception:
        log.exception("prediction failed")
        return jsonify(error="The model could not score this customer."), 500

    level = risk_level(prob)
    log.info("scored %.2f (%s)", prob, level)
    return jsonify(
        churn_prediction="Yes" if prob >= HIGH_AT else "No",
        churn_probability=round(prob, 4),
        risk_level=level,
        levers=levers,
    )


@app.get("/predict")
def predict_hint():
    return jsonify(error="Send a POST request with the customer as JSON."), 405


@app.errorhandler(405)
def method_not_allowed(_):
    return jsonify(error="Method not allowed."), 405


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Request body is too large."), 413


@app.after_request
def add_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return resp


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG") == "1",
    )
