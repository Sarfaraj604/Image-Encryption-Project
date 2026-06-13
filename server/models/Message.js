const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  encryptedData: { type: Buffer, required: true },
  createdAt: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
});

module.exports = mongoose.model('Message', messageSchema);
