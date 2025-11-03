// models/Reservation.js
const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  fullname: { type: String, required: true }, // nom du client
  date: { type: String, required: true }, // ex: '2025-10-31'
  time: { type: String, required: true }, // ex: '10:00'
  message: { type: String }, // ex: '10:00'
  services :{ type: String, required: true },
  mobile:{ type: String, required: true }
},
{
  timestamps:true
});

module.exports = mongoose.model('Reservation', reservationSchema);
