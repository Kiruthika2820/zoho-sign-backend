const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();
let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getZohoAccessToken() {
  const now = Date.now();

  // Reuse cached token if still valid (refresh 2 min before actual expiry)
  if (cachedAccessToken && now < tokenExpiresAt - 2 * 60 * 1000) {
    return cachedAccessToken;
  }

  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in";

  if (!process.env.ZOHO_REFRESH_TOKEN || !process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    throw new Error(
      "Missing required env vars. ZOHO_REFRESH_TOKEN present: " + !!process.env.ZOHO_REFRESH_TOKEN +
      ", ZOHO_CLIENT_ID present: " + !!process.env.ZOHO_CLIENT_ID +
      ", ZOHO_CLIENT_SECRET present: " + !!process.env.ZOHO_CLIENT_SECRET
    );
  }

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
  tokenExpiresAt = now + (response.data.expires_in * 1000);

  console.log("Zoho access token refreshed. Expires in", response.data.expires_in, "seconds");

  return cachedAccessToken;
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

const ZOHO_SIGN_API_BASE_URL =
  process.env.ZOHO_SIGN_API_BASE_URL || "https://sign.zoho.in/api/v1";

const ORGANIZATION_ID = process.env.ORGANIZATION_ID;
console.log("ORGANIZATION_ID =", ORGANIZATION_ID);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Debug route: check which env vars are loaded (remove after fixing) ---
app.get("/debug-env", (req, res) => {
  res.json({
    ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID ? "present" : "MISSING",
    ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET ? "present" : "MISSING",
    ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN ? "present" : "MISSING",
    ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL || "using default (accounts.zoho.in)",
    ORGANIZATION_ID: process.env.ORGANIZATION_ID ? "present" : "MISSING",
    ZOHO_SIGN_API_BASE_URL: process.env.ZOHO_SIGN_API_BASE_URL || "using default"
  });
});

app.post('/create-template', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Missing file upload.' });
    }

    const { recipientName, recipientEmail } = req.body;
    if (!recipientName || !recipientEmail) {
      return res.status(400).json({ success: false, message: 'recipientName and recipientEmail are required.' });
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
  }
   catch (error) {
  console.error("GET PDF ERROR:");
  console.error(error.response?.data || error.message || error);

  return res.status(500).json({
    success: false,
    message: error.response?.data || error.message || error
  });
}
});

app.get("/getInvoicePdf", async (req, res) => {
    try {
        const invoiceId = req.query.invoiceId;

        if (!invoiceId) {
            return res.status(400).json({ success: false, message: "invoiceId is required" });
        }

        const accessToken = await getZohoAccessToken();

        const response = await axios.get(
    `https://www.zohoapis.in/books/v3/invoices/pdf`,
            {
               params: {
    organization_id: ORGANIZATION_ID,
    invoice_ids: invoiceId
},
                responseType: "arraybuffer",
                headers: {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    Accept: "application/pdf"
}
            }
        );

        const pdf = Buffer.from(response.data).toString("base64");

        res.json({
            success: true,
            pdf
        });

    } catch (err) {
        let errorDetail;
        if (err.response?.data) {
            // Zoho errors often come back as arraybuffer/JSON — try to decode
            try {
                errorDetail = Buffer.isBuffer(err.response.data)
                    ? JSON.parse(err.response.data.toString("utf-8"))
                    : err.response.data;
            } catch {
                errorDetail = err.response.data.toString?.() || err.message;
            }
        } else {
            errorDetail = err.message || String(err);
        }
console.log("Organization ID =", ORGANIZATION_ID);
console.log("Invoice ID =", invoiceId);
        console.log("getInvoicePdf error:", errorDetail);

        res.status(500).json({
            success: false,
            message: "Unable to fetch PDF",
            debug: errorDetail
        });
    }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Zoho backend running on ${PORT}`);
  });
}