import express, { Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import {
    LoginRequest,
    PlayFabResponse,
    TokenExchangeRequest,
    TokenExchangeResponse,
    ErrorResponse,
    HealthResponse,
    SendTransactionResponse,
    SendTransactionRequest,
    RequestAccountsResponse
} from './types';
import * as passport from '@imtbl/passport';
import * as config from '@imtbl/config';
import * as provider from '@imtbl/x-provider';
import * as xClient from '@imtbl/x-client';
import { BrowserProvider, getAddress } from 'ethers';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '1111', 10);

app.use(express.json());

const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const PLAYFAB_BASE_URL = `https://${PLAYFAB_TITLE_ID}.playfabapi.com`;
const TOKEN_EXCHANGE_URL = 'https://api.sandbox.immutable.com/v1/token-exchange';//'http://localhost:8070/v1/token-exchange';
const CLIENT_ID = process.env.CLIENT_ID;
const SECRET_API_KEY = process.env.SECRET_API_KEY;

const environment = config.Environment.SANDBOX;
const baseConfig = new config.ImmutableConfiguration({ environment });

// let passportConfig: passport.PassportModuleConfiguration = {
//     baseConfig,
//     clientId: CLIENT_ID ?? '',
//     redirectUri: 'https://localhost:3000/',
//     logoutRedirectUri: 'https://auth.dev.immutable.com:/im-logged-out/',
//     audience: 'openid offline_access profile email transact',
//     scope: 'platform_api',
//     crossSdkBridgeEnabled: true,
//     logoutMode: 'redirect',
//     overrides: {
//     authenticationDomain: 'https://auth.dev.immutable.com',
//     magicPublishableApiKey: 'pk_live_4058236363130CA9', // Public key
//     magicProviderId: 'C9odf7hU4EQ5EufcfgYfcBaT5V6LhocXyiPRhIjw2EY=', // Public key
//     passportDomain: 'https://passport.dev.immutable.com',
//     imxPublicApiDomain: 'https://api.dev.immutable.com',
//     immutableXClient: new xClient.IMXClient({
//         baseConfig,
//         overrides: {
//         immutableXConfig: xClient.createConfig({
//             basePath: 'https://api.dev.x.immutable.com',
//             chainID: 5,
//             coreContractAddress: '0xd05323731807A35599BF9798a1DE15e89d6D6eF1',
//             registrationContractAddress: '0x7EB840223a3b1E0e8D54bF8A6cd83df5AFfC88B2',
//         }),
//         },
//     }),
//     zkEvmRpcUrl: 'https://rpc.dev.immutable.com',
//     relayerUrl: 'https://api.dev.immutable.com/relayer-mr',
//     indexerMrBasePath: 'https://api.dev.immutable.com',
//     orderBookMrBasePath: 'https://api.dev.immutable.com',
//     passportMrBasePath: 'https://api.dev.immutable.com',
//     },
// };

let passportConfig: passport.PassportModuleConfiguration = {
    baseConfig,
    clientId: CLIENT_ID ?? '',
    audience: 'openid offline_access profile email transact',
    scope: 'platform_api',
    redirectUri: 'https://localhost:3000/',
    logoutRedirectUri: 'https://auth.immutable.com:/im-logged-out/',
    crossSdkBridgeEnabled: true,
    jsonRpcReferrer: 'http://imtblgamesdk.local',
    logoutMode: 'redirect',
  };

let passportClient = new passport.Passport(passportConfig);

let zkEvmProviderInstance: passport.Provider | null;

const setZkEvmProvider = (zkEvmProvider: passport.Provider | null | undefined): boolean => {
    if (zkEvmProvider !== null && zkEvmProvider !== undefined) {
      zkEvmProviderInstance = zkEvmProvider;
      console.log('zkEvm provider set');
      return true;
    }
    console.log('No zkEvm provider');
    return false;
  };

const getZkEvmProvider = (): passport.Provider => {
    if (zkEvmProviderInstance == null) {
        throw new Error('No zkEvm provider');
    }
    return zkEvmProviderInstance;
};

// Reusable async handler wrapper
const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next?: Function) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            const axiosError = error as AxiosError;
            console.error(`Error in ${req.path} endpoint:`, axiosError.response?.data || axiosError.message || error);

            // Handle specific error types
            if (axiosError.response?.status === 401) {
                return res.status(401).json({ error: 'Unauthorised' });
            }

            if (axiosError.response?.status === 404) {
                return res.status(404).json({ error: 'Not found' });
            }

            res.status(500).json({
                error: 'Internal server error',
                details: axiosError.response?.data || axiosError.message || error?.message || 'Unknown error'
            });
        });
    };
};

app.post('/v2/login', asyncHandler(async (req: Request<{}, TokenExchangeResponse | ErrorResponse, LoginRequest>, res: Response<TokenExchangeResponse | ErrorResponse>) => {
    const { sessionTicket } = req.body;

    if (!sessionTicket) {
        return res.status(400).json({ error: 'sessionTicket is required' });
    }

    // Get email from PlayFab
    console.log('Getting PlayFab account info...');
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

    const email = playfabResponse.data.data.AccountInfo.PrivateInfo?.Email;
    if (!email) {
        return res.status(400).json({ error: 'Email not found in PlayFab account info' });
    }

    console.log('Email extracted from PlayFab:', email);

    // Exchange token with Immutable
    console.log('Exchanging tokens...');
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

    // Initialize Passport client
    const user = await passportClient.storeTokens(tokenResponse.data);
    console.log('User stored:', user);

    const zkEvmProvider = await passportClient.connectEvm();
    setZkEvmProvider(zkEvmProvider);
    
    if (!zkEvmProvider) {
        throw new Error('Failed to set up provider');
    }

    // Get tokens for logging
    const accessToken = await passportClient.getAccessToken();
    const idToken = await passportClient.getIdToken();
    console.log('Access token:', accessToken);
    console.log('ID token:', idToken);

    // const accounts = await getZkEvmProvider().request({
    //     method: 'eth_requestAccounts',
    // });
    // console.log('Accounts:', accounts);

    res.json(tokenResponse.data);
}));

app.post('/v2/request-accounts', asyncHandler(async (req: Request, res: Response<RequestAccountsResponse | ErrorResponse>) => {
    const accounts = await getZkEvmProvider().request({
        method: 'eth_requestAccounts',
    });
    
    console.log('Accounts:', accounts);
    res.json({ accounts });
}));

app.post('/v2/send-transaction', asyncHandler(async (req: Request<{}, SendTransactionResponse | ErrorResponse, SendTransactionRequest>, res: Response<SendTransactionResponse | ErrorResponse>) => {
    const zkEvmProvider = getZkEvmProvider();
    const browserProvider = new BrowserProvider(zkEvmProvider);
    const signer = await browserProvider.getSigner();

    const tx = await signer.sendTransaction(req.body);
    const response = await tx.wait();
    const responseJson = response?.toJSON();
    
    res.json({
        transactionHash: responseJson?.hash,
    });
}));

// Health check endpoint
app.get('/health', (req: Request, res: Response<HealthResponse>) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Login endpoint: POST http://localhost:${PORT}/v2/login`);
    console.log(`Request accounts: POST http://localhost:${PORT}/v2/request-accounts`);
    console.log(`Send transaction: POST http://localhost:${PORT}/v2/send-transaction`);
}); 