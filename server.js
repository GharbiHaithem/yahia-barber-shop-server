const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const Reservation = require("./models/Reservation");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- SOCKET.IO CONFIG ---
const io = new Server(server, {
  cors: {
    origin: "*", // ⚠️ en prod => ton vrai domaine React
    methods: ["GET", "POST"]
  }
});

// 🧠 Injecter io dans toutes les requêtes Express
app.use((req, res, next) => {
  req.io = io;
  next();
});

// --- SOCKET EVENTS ---
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Client déconnecté :", socket.id);
  });
});

// --- ROUTES ---

// 📅 Récupérer les réservations par date
app.get("/api/reservations/:date", async (req, res) => {
  try {
    const { date } = req.params;
    let reservations;

    if (!date) {
      reservations = await Reservation.find().sort({ createdAt: -1 });
    } else if (date === "today") {
      const today = new Date().toISOString().split("T")[0];
      reservations = await Reservation.find({ date: today }).sort({ time: 1 });
    } else {
      reservations = await Reservation.find({ date }).sort({ time: 1 });
    }

    res.json(reservations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// 📜 Récupérer toutes les réservations (tri par création)
app.get("/api/reservations", async (req, res) => {
  try {
    const reservations = await Reservation.find().sort({ createdAt: -1 });
    res.json(reservations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// ➕ Créer une nouvelle réservation
app.post("/api/reservations", async (req, res) => {
  try {
    const { fullname, date, time, services, message, mobile } = req.body;

    if (!fullname || !date || !time) {
      return res.status(400).json({ message: "⚠️ Champs manquants" });
    }

    const now = new Date();
    now.setSeconds(0, 0);

    const selectedDateTime = new Date(date);
    selectedDateTime.setHours(Number(time), 0, 0, 0);

    if (selectedDateTime < now) {
      return res.status(400).json({
        message: `❌ Ce créneau (${date} à ${time}h) est déjà passé.`,
      });
    }

    // 🕒 Déterminer la durée du service
    let duration = 1;
    const normalized = (services || "").toLowerCase().trim();
    if (
      normalized === "protéine + coupe cheveux" ||
      (normalized.includes("protéine") && normalized.includes("coupe"))
    ) {
      duration = 2;
    }

    // ---- Vérification double sens ----
    // 1️⃣ Créneaux que cette réservation va occuper
    const heuresDemandées = [];
    for (let i = 0; i < duration; i++) {
      heuresDemandées.push(String(Number(time) + i));
    }

    // 2️⃣ Trouver toutes les réservations du même jour
    const existingReservations = await Reservation.find({ date });

    // 3️⃣ Vérifier les chevauchements (services longs)
    for (const r of existingReservations) {
      let dureeExistante = 1;
      const serviceExistant = (r.services || "").toLowerCase();

      if (
        serviceExistant === "protéine + coupe cheveux" ||
        (serviceExistant.includes("protéine") && serviceExistant.includes("coupe"))
      ) {
        dureeExistante = 2;
      }

      // heures bloquées par cette réservation existante
      const heuresOccupées = [];
      for (let i = 0; i < dureeExistante; i++) {
        heuresOccupées.push(String(Number(r.time) + i));
      }

      // 🔍 Vérifie si le créneau demandé chevauche un autre
      if (heuresDemandées.some((h) => heuresOccupées.includes(h))) {
        return res.status(400).json({
          message: `❌ Le créneau ${time}h chevauche une réservation existante (${r.time}h - service "${r.services}").`,
        });
      }
    }

    // 4️⃣ Vérifier le nombre max (2 réservations par heure)
    const countAtSameHour = await Reservation.countDocuments({ date, time });
    if (countAtSameHour >= 2) {
      return res.status(400).json({
        message: `❌ Le créneau ${time}h est complet (${countAtSameHour}/2 réservations).`,
      });
    }

    // ✅ Créer la réservation
    const newReservation = new Reservation({
      fullname,
      date,
      time: String(time),
      services,
      message,
      mobile,
    });

    await newReservation.save();

    // 🔔 Émettre la notification Socket.io
    io.emit("newReservation", newReservation);
    console.log("📢 Nouvelle réservation :", newReservation.fullname);

    res.status(201).json(newReservation);

  } catch (error) {
    console.error("Erreur lors de la réservation :", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});


app.get("/api/reservations/disabled/:date", async (req, res) => {
  try {
    const { date } = req.params;
    const existingReservations = await Reservation.find({ date });

    let disabledHours = new Set();

    existingReservations.forEach((r) => {
      let duree = 1;
      const s = (r.services || "").toLowerCase();

      if (
        s === "protéine + coupe cheveux" ||
        (s.includes("protéine") && s.includes("coupe"))
      ) {
        duree = 2;
      }

      for (let i = 0; i < duree; i++) {
        disabledHours.add(String(Number(r.time) + i));
      }
    });

    // 🔒 Supprimer les heures passées du jour actuel
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    if (date === today) {
      const currentHour = now.getHours();
      for (let h = 0; h <= currentHour; h++) {
        disabledHours.add(String(h));
      }
    }

    // 🔥 Ajouter les heures pleines (2 réservations max par heure)
    const allTimes = existingReservations.map((r) => r.time);
    const hourCounts = allTimes.reduce((acc, h) => {
      acc[h] = (acc[h] || 0) + 1;
      return acc;
    }, {});
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count >= 2) disabledHours.add(hour);
    }

    res.json({ disabled: Array.from(disabledHours) });
  } catch (err) {
    console.error("Erreur disabled hours:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});


// --- MONGOOSE ---
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((err) => console.error("❌ Erreur MongoDB :", err));

// --- SERVER START ---
const PORT = 5500;
server.listen(PORT, () =>
  console.log(`🚀 Serveur en ligne sur http://localhost:${PORT}`)
);
