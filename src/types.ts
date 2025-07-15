export interface LoginRequest {
    sessionTicket: string;
}

export interface PlayFabAccountInfo {
    PrivateInfo?: {
        Email?: string;
    };
    PlayFabId: string;
    Username?: string;
}

export interface PlayFabResponse {
    data: {
        AccountInfo: PlayFabAccountInfo;
    };
}

export interface TokenExchangeRequest {
    email: string;
    client_id: string;
}

export interface TokenExchangeResponse {
    access_token: string;
    id_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
}

export interface ErrorResponse {
    error: string;
    details?: any;
}

export interface HealthResponse {
    status: string;
    timestamp: string;
} 