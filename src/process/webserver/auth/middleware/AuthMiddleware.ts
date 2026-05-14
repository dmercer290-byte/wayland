/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthService } from '../service/AuthService';
import { createAuthMiddleware } from './TokenMiddleware';
import { SECURITY_CONFIG } from '../../config/constants';

// Express Request type extension is defined in src/types/express.d.ts

/**
 * Authentication middleware class
 */
export class AuthMiddleware {
  private static readonly jsonAuthMiddleware = createAuthMiddleware('json');

  /**
   * JWT authentication middleware
   */
  public static authenticateToken(req: Request, res: Response, next: NextFunction): void {
    AuthMiddleware.jsonAuthMiddleware(req, res, next);
  }

  /**
   * CORS middleware for development
   */
  public static corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  }

  /**
   * Per-request CSP nonce middleware.
   *
   * Mints a cryptographically random nonce and exposes it on res.locals.cspNonce
   * so downstream middleware can (a) include it in the Content-Security-Policy
   * header and (b) inject it into any server-rendered inline <script> tags.
   *
   * Must run BEFORE securityHeadersMiddleware.
   */
  public static cspNonceMiddleware(_req: Request, res: Response, next: NextFunction): void {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  }

  /**
   * Security headers middleware
   */
  public static securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
    // Prevent clickjacking
    res.header('X-Frame-Options', SECURITY_CONFIG.HEADERS.FRAME_OPTIONS);

    // Prevent MIME type sniffing
    res.header('X-Content-Type-Options', SECURITY_CONFIG.HEADERS.CONTENT_TYPE_OPTIONS);

    // Enable XSS protection
    res.header('X-XSS-Protection', SECURITY_CONFIG.HEADERS.XSS_PROTECTION);

    // Referrer policy
    res.header('Referrer-Policy', SECURITY_CONFIG.HEADERS.REFERRER_POLICY);

    // Content Security Policy: nonce-gated inline scripts (no 'unsafe-inline').
    // Falls back to a freshly minted nonce if cspNonceMiddleware was skipped.
    const nonce =
      typeof res.locals.cspNonce === 'string' && res.locals.cspNonce.length > 0
        ? (res.locals.cspNonce as string)
        : crypto.randomBytes(16).toString('base64');
    if (res.locals.cspNonce !== nonce) {
      res.locals.cspNonce = nonce;
    }

    const isDevelopment = process.env.NODE_ENV === 'development';
    const cspPolicy = isDevelopment
      ? SECURITY_CONFIG.HEADERS.buildCspDev(nonce)
      : SECURITY_CONFIG.HEADERS.buildCspProd(nonce);

    res.header('Content-Security-Policy', cspPolicy);

    next();
  }

  /**
   * Request logging middleware
   */
  public static requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Only log API requests; skip Vite module / static asset requests to reduce noise
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/login')) {
      next();
      return;
    }

    const start = Date.now();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    console.log(`[${new Date().toISOString()}] ${req.method} ${url} - ${ip}`);

    // Log response time
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${url} - ${res.statusCode} - ${duration}ms`);
    });

    next();
  }

  /**
   * Input validation middleware for login
   */
  public static validateLoginInput(req: Request, res: Response, next: NextFunction): void {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
      return;
    }

    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Username and password must be strings.',
      });
      return;
    }

    // Basic length checks
    if (username.length > 32 || password.length > 128) {
      res.status(400).json({
        success: false,
        error: 'Invalid input length.',
      });
      return;
    }

    next();
  }

  /**
   * Input validation middleware for registration
   */
  public static validateRegisterInput(req: Request, res: Response, next: NextFunction): void {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
      return;
    }

    // Validate username
    const usernameValidation = AuthService.validateUsername(username);
    if (!usernameValidation.isValid) {
      res.status(400).json({
        success: false,
        error: 'Invalid username.',
        details: usernameValidation.errors,
      });
      return;
    }

    // Validate password strength
    const passwordValidation = AuthService.validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      res.status(400).json({
        success: false,
        error: 'Password does not meet security requirements.',
        details: passwordValidation.errors,
      });
      return;
    }

    next();
  }
}

export default AuthMiddleware;
