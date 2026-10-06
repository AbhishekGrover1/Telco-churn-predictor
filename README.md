
# ***Telo Churn Predictor***
 <a href="https://ford-price-intelligence-1.onrender.com">
  <img src="https://img.shields.io/badge/Live%20Demo-8B5CF6?style=flat-square&logo=render&logoColor=white" alt="Live Demo">
   <img src="https://img.shields.io/badge/Python-3.12%2B-FF0000?style=flat-square&logo=python&logoColor=white" alt="Python">
    <img src="https://img.shields.io/badge/gunicorn-10B981?style=flat-square&logo=fastapi&logoColor=white" alt="Gunicorn">
    <img src="https://img.shields.io/badge/scikit--learn-1.6-F59E0B?style=flat-square&logo=scikitlearn&logoColor=white" alt="scikit-learn">
         <img src="https://img.shields.io/badge/Pandas%2B-FF0000?style=flat-square&logo=pandas&logoColor=white" alt="Pandas">
<img src="https://img.shields.io/badge/JavaScript-F472B6?style=flat-square&logo=javascript&logoColor=white" alt="JavaScript">
    <img src="https://img.shields.io/badge/License-MIT-E879F9?style=flat-square" alt="MIT License">
     <img src="https://img.shields.io/badge/Numpy%2B-FF0000?style=flat-square&logo=Numpy&logoColor=white" alt="Numpy">
     
##### *Production-oriented vehicle price prediction powered by machine learning, FastAPI, and a custom web interface*


</div>

---
## Contents

- [Stack](#stack)
- [Model](#model)
- [API](#api)
- [Run locally](#run-locally)
- [Project structure](#project-structure)
- [Author](#author)

## Stack

| Layer | Tools |
| --- | --- |
| Model | scikit-learn `Pipeline` (`ColumnTransformer`, `StandardScaler`, `OneHotEncoder`, `RandomForestClassifier`), joblib |
| Data | pandas, NumPy |
| Backend | Flask, flask-cors, Gunicorn |
| Frontend | HTML, CSS, JavaScript |
| Hosting | Render (`render.yaml`) |

## Model

| | |
| --- | --- |
| Data | 7,043 customers, 26.5% churned. [Telco Customer Churn](https://www.kaggle.com/datasets/blastchar/telco-customer-churn) on Kaggle |
| Split | 80/20, stratified, `random_state=42` (5,634 train, 1,409 test) |
| Estimator | `RandomForestClassifier`, 100 trees, `class_weight="balanced"` |
| Test accuracy | 0.78 |
| Churn class | precision 0.61, recall 0.47, F1 0.53 |

Training and evaluation live in [`telco_customer_churn.ipynb`](telco_customer_churn.ipynb). The fitted pipeline is exported as `telco_churn_pipeline.pkl`.

On top of the raw probability, the API assigns a risk tier (low below 0.30, medium up to 0.50, high from 0.50, the same cut-off the pipeline's `predict()` uses) and re-scores the customer with one field changed at a time to list the changes that would lower it most. Fields that depend on each other (no phone service, no internet service) are reconciled to the convention used in the training data before scoring.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | The web UI |
| `GET` | `/health` | Liveness check |
| `POST` | `/predict` | Score one customer |

```bash
curl -X POST http://127.0.0.1:5000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "gender": "Female", "Partner": "Yes", "Dependents": "No", "tenure": 12,
    "PhoneService": "Yes", "MultipleLines": "No", "InternetService": "Fiber optic",
    "OnlineSecurity": "No", "OnlineBackup": "No", "DeviceProtection": "No",
    "TechSupport": "No", "StreamingTV": "No", "StreamingMovies": "No",
    "Contract": "Month-to-month", "PaperlessBilling": "Yes",
    "PaymentMethod": "Electronic check", "MonthlyCharges": 70.5, "TotalCharges": 846
  }'
```

```json
{
  "churn_prediction": "Yes",
  "churn_probability": 0.73,
  "levers": [
    { "delta": -0.43, "field": "Contract", "value": "One year" },
    { "delta": -0.36, "field": "PaymentMethod", "value": "Mailed check" },
    { "delta": -0.36, "field": "PaperlessBilling", "value": "No" }
  ],
  "risk_level": "high"
}
```

Invalid input returns `422` with a message per field. A body that is not a JSON object returns `400`.

## Run locally

Python 3.12 is what the pinned scikit-learn (1.6.1, the version the model was saved with) is tested on.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>.

| Setting | Default | Notes |
| --- | --- | --- |
| `PORT` | `5000` | Set by Render in production |
| `ALLOWED_ORIGINS` | `*` | Comma-separated origins allowed to call the API cross-origin |
| `<meta name="api-base">` | empty | In `static/index.html`. Point it at the API origin to host the UI elsewhere |

## Project structure

```text
.
├── app.py                        Flask API and static file server
├── telco_churn_pipeline.pkl      fitted scikit-learn pipeline
├── telco_customer_churn.ipynb    EDA, training, evaluation
├── requirements.txt
├── render.yaml                   Render blueprint
├── LICENSE
└── static/
    ├── index.html
    ├── style.css
    └── script.js
```

## Author

Built by **Abhishek Grover**.

[![GitHub](https://img.shields.io/badge/GitHub-AbhishekGrover1-e5e7eb?style=flat-square&logo=github&logoColor=0a0a0c&labelColor=0a0a0c)](https://github.com/AbhishekGrover1)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-abhishek--grover--07-bfdbfe?style=flat-square&logo=linkedin&logoColor=0a0a0c&labelColor=0a0a0c)](https://www.linkedin.com/in/abhishek-grover-07)

Released under the [MIT License](LICENSE).
