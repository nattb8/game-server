import express, { Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import {
    LoginRequest,
    PlayFabResponse,
    TokenExchangeRequest,
    TokenExchangeResponse,
    ErrorResponse,
    HealthResponse
} from './types';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '1111', 10);

app.use(express.json());

const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const PLAYFAB_BASE_URL = `https://${PLAYFAB_TITLE_ID}.playfabapi.com`;
const TOKEN_EXCHANGE_URL = 'http://localhost:8070/v1/token-exchange';
const CLIENT_ID = process.env.CLIENT_ID;
const SECRET_API_KEY = process.env.SECRET_API_KEY;

app.post('/login', async (req: Request<{}, TokenExchangeResponse | ErrorResponse, LoginRequest>, res: Response<TokenExchangeResponse | ErrorResponse>) => {
    try {
        const { sessionTicket } = req.body;

        if (!sessionTicket) {
            return res.status(400).json({ error: 'sessionTicket is required' });
        }

        console.log('Calling PlayFab GetAccountInfo...');
        const playfabResponse = await axios.post<PlayFabResponse>(
            `${PLAYFAB_BASE_URL}/Client/GetAccountInfo`,
            {},
            {
                headers: {
                    'X-Authorization': sessionTicket,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Get email from PlayFab response
        const accountInfo = playfabResponse.data.data.AccountInfo;
        const email = accountInfo.PrivateInfo?.Email;

        if (!email) {
            return res.status(400).json({ error: 'Email not found in PlayFab account info' });
        }

        console.log('Email extracted from PlayFab:', email);

        // Call token exchange endpoint
        console.log('Calling token exchange endpoint...');
        const tokenResponse = await axios.post<TokenExchangeResponse>(
            TOKEN_EXCHANGE_URL,
            {
                email: email,
                client_id: CLIENT_ID
            } as TokenExchangeRequest,
            {
                headers: {
                    'x-immutable-api-key': SECRET_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Return the token exchange response directly
        res.json(tokenResponse.data);

    } catch (error) {
        const axiosError = error as AxiosError;
        console.error('Error in /login endpoint:', axiosError.response?.data || axiosError.message);

        if (axiosError.response?.status === 401) {
            return res.status(401).json({ error: 'Invalid session ticket' });
        }

        if (axiosError.response?.status === 404) {
            return res.status(404).json({ error: 'Token exchange endpoint not found' });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: axiosError.response?.data || axiosError.message
        });
    }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response<HealthResponse>) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Login endpoint: POST http://localhost:${PORT}/login`);
}); 