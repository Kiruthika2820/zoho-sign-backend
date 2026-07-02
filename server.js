const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads/') });
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_SIGN_API_BASE_URL = process.env.ZOHO_SIGN_API_BASE_URL || 'https://sign.zoho.in/api/v1';

if (!ZOHO_OAUTH_TOKEN) {
  console.error('Missing ZOHO_OAUTH_TOKEN in environment. Copy .env.example to .env and set the token.');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/create-template', upload.single('file'), async (req, res) => {
  try {

    console.log("========== REQUEST ==========");
    console.log("BODY =", req.body);
    console.log("FILE =", req.file);

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Missing file upload.' });
    }

  const { recipientName, recipientEmail } = req.body;

console.log("recipientName =", recipientName);
console.log("recipientEmail =", recipientEmail);

    if (!recipientName || !recipientEmail) {
      await deleteFile(req.file.path);
      return res.status(400).json({ success: false, message: 'recipientName and recipientEmail are required.' });
    }

    if (!ZOHO_OAUTH_TOKEN) {
      await deleteFile(req.file.path);
      return res.status(500).json({ success: false, message: 'Zoho OAuth token is not configured.' });
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path));
    form.append('data', JSON.stringify({
      templates: {
        template_name: `Invoice Template - ${recipientName}`,
        request_type_id: '2000000000135',
        expiration_days: 1,
        is_sequential: true,
        reminder_period: 8,
        email_reminders: false,
        actions: [
          {
            action_type: 'SIGN',
            signing_order: 0,
            recipient_name: recipientName,
            recipient_email: recipientEmail,
            recipient_phonenumber: '',
            recipient_countrycode: '',
            role: '1',
            private_notes: 'Please sign this invoice',
            verify_recipient: true,
            verification_type: 'EMAIL',
            verification_code: ''
          }
        ]
      }
    }));

    console.log("Uploading Template...");

const templateResponse = await axios.post(

    `${ZOHO_SIGN_API_BASE_URL}/templates`,

    form,

    {

        headers: {

            Authorization:
                `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,

            ...form.getHeaders()

        }

    }

);

console.log("================================");

console.log("ZOHO TEMPLATE RESPONSE");

console.log("================================");

console.log(

    JSON.stringify(

        templateResponse.data,

        null,

        2

    )

);

await deleteFile(req.file.path);

return res.json({

    success: true,

    response: templateResponse.data

});
  } catch (error) {
    console.error('Create template error:', error?.response?.data || error.message || error);

    if (req.file && req.file.path) {
      await deleteFile(req.file.path);
    }

    const message = error?.response?.data?.message || error?.message || 'Unable to create Zoho Sign template.';
    return res.status(500).json({ success: false, message });
  }
});

async function deleteFile(filePath) {
  return new Promise((resolve) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Failed to delete file:', filePath, err);
      }
      resolve();
    });
  });
}

module.exports = app;
