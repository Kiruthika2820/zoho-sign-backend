const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();
// --- Zoho Access Token Auto-Refresh ---
let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getZohoAccessToken() {
  const now = Date.now();

  // Reuse cached token if still valid (refresh 2 min before actual expiry)
  if (cachedAccessToken && now < tokenExpiresAt - 2 * 60 * 1000) {
    return cachedAccessToken;
  }

  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in";

  const response = await axios.post(
    `${accountsUrl}/oauth/v2/token`,
    null,
    {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token"
      }
    }
  );

  if (!response.data.access_token) {
    console.error("Token refresh failed:", response.data);
    throw new Error("Unable to refresh Zoho access token: " + JSON.stringify(response.data));
  }

  cachedAccessToken = response.data.access_token;
  // expires_in is in seconds (usually 3600)
  tokenExpiresAt = now + (response.data.expires_in * 1000);

  console.log("Zoho access token refreshed. Expires in", response.data.expires_in, "seconds");

  return cachedAccessToken;
}
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_SIGN_API_BASE_URL =
  process.env.ZOHO_SIGN_API_BASE_URL || "https://sign.zoho.in/api/v1";

const ZOHO_BOOKS_TOKEN = process.env.ZOHO_BOOKS_TOKEN;
const ORGANIZATION_ID = process.env.ORGANIZATION_ID;

if (!ZOHO_OAUTH_TOKEN) {
  console.error('Missing ZOHO_OAUTH_TOKEN in environment. Copy .env.example to .env and set the token.');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/create-template', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Missing file upload.' });
    }

    const { recipientName, recipientEmail } = req.body;
    if (!recipientName || !recipientEmail) {
      return res.status(400).json({ success: false, message: 'recipientName and recipientEmail are required.' });
    }

    if (!ZOHO_OAUTH_TOKEN) {
      return res.status(500).json({ success: false, message: 'Zoho OAuth token is not configured.' });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'SignedInvoice.pdf',
      contentType: 'application/pdf'
    });
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

    const accessToken = await getZohoAccessToken();

const templateResponse = await axios.post(`${ZOHO_SIGN_API_BASE_URL}/templates`, form, {
  headers: {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    ...form.getHeaders()
  },
  maxBodyLength: Infinity,
  maxContentLength: Infinity
});

    const templateData = templateResponse.data;
    return res.json({
      success: true,
      response: templateData,
      templateId: templateData?.templates?.template_id || templateData?.template_id || null,
      message: 'Template created successfully.'
    });
  } catch (error) {
    console.error('Create template error:', error?.response?.data || error.message || error);
    const message = error?.response?.data?.message || error?.message || 'Unable to create Zoho Sign template.';
    return res.status(500).json({ success: false, message });
  }
});
app.post("/invoicePdf", async (req, res) => {

  try {

    const { invoiceId } = req.body;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "invoiceId is required"
      });
    }

    const response = await axios.get(

      `https://www.zohoapis.in/books/v3/invoices/${invoiceId}`,

      {

        params: {
          organization_id: ORGANIZATION_ID,
          accept: "pdf"
        },

        headers: {
          Authorization:
            `Zoho-oauthtoken ${ZOHO_BOOKS_TOKEN}`
        },

        responseType: "arraybuffer"

      }

    );

    res.setHeader("Content-Type", "application/pdf");

    res.send(response.data);

  }

  catch (err) {

    console.log(err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});
app.get("/getInvoicePdf", async (req, res) => {
    try {
        const invoiceId = req.query.invoiceId;

        const accessToken = await getZohoAccessToken();

        const response = await axios.get(
            `https://www.zohoapis.in/books/v3/invoices/${invoiceId}`,
            {
                params: {
                    organization_id: process.env.ORGANIZATION_ID,
                    accept: "pdf"
                },
                responseType: "arraybuffer",
                headers: {
                    Authorization: `Zoho-oauthtoken ${accessToken}`
                }
            }
        );

        const pdf = Buffer.from(response.data).toString("base64");

        res.json({
            success: true,
            pdf
        });

    } catch (err) {
        console.log(err.response?.data || err.message || err);
        res.status(500).json({
            success: false,
            message: "Unable to fetch PDF"
        });
    }
});
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Zoho backend running on ${PORT}`);
  });
}