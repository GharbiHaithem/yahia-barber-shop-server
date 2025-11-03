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

    // 🕓 Obtenir la date et l'heure actuelles
    const now = new Date();
    now.setSeconds(0, 0); // ignore les millisecondes

    // 🧭 Convertir la date du formulaire
    const [hour, minute] = time.split(":").map(Number);
    const selectedDateTime = new Date(date);
    selectedDateTime.setHours(hour, minute, 0, 0);

    // 🔒 Vérifier si la date + heure est passée
    if (selectedDateTime < now) {
      return res.status(400).json({
        message: `❌ Ce créneau (${date} à ${time}) est déjà passé.`,
      });
    }

    // 🔢 Vérifier le nombre max de réservations pour ce créneau
    const existingCount = await Reservation.countDocuments({ date, time });
    if (existingCount >= 3) {
      return res.status(400).json({
        message: `❌ Ce créneau (${time}) est déjà complet (${existingCount}/3 réservations).`,
      });
    }

    // ✅ Créer la réservation
    const newReservation = new Reservation({
      fullname,
      date,
      time,
      services,
      message,
      mobile,
    });

    await newReservation.save();

    // ✅ Émettre l'événement Socket.io
    io.emit("newReservation", newReservation);
    console.log("📢 Nouvelle réservation :", newReservation.fullname);

    res.status(201).json(newReservation);
  } catch (error) {
    console.error("Erreur lors de la réservation :", error);
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
