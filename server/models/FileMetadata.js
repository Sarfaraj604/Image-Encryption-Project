const mongoose = require('mongoose');

const fileMetadataSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  operation: { type: String, enum: ['encrypt', 'decrypt'], required: true },
  mimeType: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('FileMetadata', fileMetadataSchema);
