import requests
import numpy as np
import os
import csv
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense

from sklearn.preprocessing import MinMaxScaler
from sklearn.ensemble import IsolationForest

app = Flask(__name__)
CORS(app)

DATA_FILE = "history.csv"
MODEL_FILE = "lstm_model.h5"

scaler = MinMaxScaler()
anomaly_model = IsolationForest(contamination=0.05)


# 🔵 VERİ ÇEK
def get_space_weather():
    try:
        sw = requests.get("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-hour.json").json()[-1]
        mag = requests.get("https://services.swpc.noaa.gov/products/solar-wind/mag-1-hour.json").json()[-1]
        xr = requests.get("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json").json()[-1]

        return [
            float(sw[2]),
            float(mag[3]),
            float(sw[1]),
            float(sw[3]),
            float(xr["flux"])
        ]
    except:
        return [500, -2, 5, 100000, 1e-6]


def get_kp():
    try:
        kp = requests.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json").json()[-1][1]
        return float(kp)
    except:
        return None


# 💾 KAYDET
def save_data(features, kp):
    file_exists = os.path.isfile(DATA_FILE)

    with open(DATA_FILE, "a", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["time","speed","bz","density","temp","xray","kp"])
        writer.writerow([datetime.utcnow().timestamp()] + features + [kp])


# 📊 DATA
def load_data(seq_len=6):
    if not os.path.exists(DATA_FILE):
        return None, None, None

    data = np.genfromtxt(DATA_FILE, delimiter=",", skip_header=1)

    if len(data) < seq_len + 1:
        return None, None, None

    X, y, raw = [], [], []

    for i in range(len(data) - seq_len - 1):
        X.append(data[i:i+seq_len, 1:-1])
        y.append(data[i+seq_len][-1])
        raw.append(data[i:i+seq_len, 1:-1])

    X = np.array(X)
    y = np.array(y)

    X_scaled = scaler.fit_transform(X.reshape(-1, X.shape[-1])).reshape(X.shape)

    return X_scaled, y, np.array(raw)


# 🧠 LSTM
def train_model():
    X, y, _ = load_data()

    if X is None:
        return None

    model = Sequential()
    model.add(LSTM(64, input_shape=(X.shape[1], X.shape[2])))
    model.add(Dense(32, activation="relu"))
    model.add(Dense(1))

    model.compile(optimizer="adam", loss="mse")
    model.fit(X, y, epochs=8, verbose=0)

    model.save(MODEL_FILE)
    return model


# 🚨 ANOMALY
def detect_anomaly():
    _, _, raw = load_data()

    if raw is None:
        return False

    flat = raw.reshape(raw.shape[0], -1)

    anomaly_model.fit(flat)

    last = flat[-1].reshape(1, -1)

    result = anomaly_model.predict(last)

    return result[0] == -1


# 🔮 TAHMİN
def predict():
    if not os.path.exists(MODEL_FILE):
        return {"error": "Model yok"}

    model = load_model(MODEL_FILE)

    data = np.genfromtxt(DATA_FILE, delimiter=",", skip_header=1)

    if len(data) < 6:
        return {"error": "Yeterli veri yok"}

    last_seq = data[-6:, 1:-1]
    last_seq_scaled = scaler.transform(last_seq)
    last_seq_scaled = np.expand_dims(last_seq_scaled, axis=0)

    kp_pred = float(model.predict(last_seq_scaled)[0][0])

    anomaly = detect_anomaly()

    # 🔥 risk skoru
    risk_score = min(100, max(0, kp_pred * 10 + (20 if anomaly else 0)))

    return {
        "kp_1h": round(kp_pred, 2),
        "storm_risk": risk_score,
        "anomaly_detected": anomaly
    }


# 🔁 UPDATE
def update():
    features = get_space_weather()
    kp = get_kp()

    if kp is None:
        return

    save_data(features, kp)
    train_model()


# 🌐 API
@app.route("/predict")
def api():
    update()
    return jsonify(predict())


@app.route("/")
def home():
    return "OrbitShield AI ULTIMATE 🚀"


if __name__ == "__main__":
    app.run(debug=True)
