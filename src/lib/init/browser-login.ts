/**
 * Browser Login - HTTP callback server for browser-based authentication
 *
 * Flow:
 * 1. Start local HTTP server on random port
 * 2. Open browser to Xano login with callback URL
 * 3. Wait for callback with access token
 * 4. Validate token and return
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

export interface BrowserLoginOptions {
  /** API URL for Xano (default: https://app.xano.com) */
  apiUrl?: string
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number
}

export interface BrowserLoginResult {
  accessToken: string
  user: {
    email: string
    name: string
  }
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Xano CLI - Login Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255,255,255,0.1);
      border-radius: 1rem;
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0 0 1rem; font-size: 2rem; }
    p { margin: 0; opacity: 0.9; }
    .checkmark { font-size: 4rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Login Successful</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`

const errorHtml = (message: string) => `<!DOCTYPE html>
<html>
<head>
  <title>Xano CLI - Login Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255,255,255,0.1);
      border-radius: 1rem;
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0 0 1rem; font-size: 2rem; }
    p { margin: 0; opacity: 0.9; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✗</div>
    <h1>Login Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(): Promise<{ port: number; server: Server; waitForToken: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    let tokenResolve: (token: string) => void
    let tokenReject: (error: Error) => void

    const tokenPromise = new Promise<string>((res, rej) => {
      tokenResolve = res
      tokenReject = rej
    })

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Only handle GET /callback
      if (req.method !== 'GET' || !req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      try {
        const url = new URL(req.url, `http://localhost`)
        const token = url.searchParams.get('token')

        if (token) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(SUCCESS_HTML)
          tokenResolve(token)
        } else {
          const error = url.searchParams.get('error') || 'No token received'
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(errorHtml(error))
          tokenReject(new Error(error))
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end(errorHtml('Internal error'))
        tokenReject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    // Listen on random available port, localhost only
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        resolve({
          port: address.port,
          server,
          waitForToken: () => tokenPromise,
        })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })

    server.on('error', reject)
  })
}

/**
 * Validate access token by calling the Xano API
 */
async function validateToken(accessToken: string, apiUrl: string): Promise<{ email: string; name: string }> {
  const response = await fetch(`${apiUrl}/api:meta/auth/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'xano-cli',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid access token')
    }

    throw new Error(`Token validation failed: ${response.status}`)
  }

  const data = await response.json() as { email: string; name: string }
  return data
}

/**
 * Open URL in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)

  // Platform-specific browser opening
  const {platform} = process
  let command: string

  if (platform === 'darwin') {
    command = `open "${url}"`
  } else if (platform === 'win32') {
    command = `start "" "${url}"`
  } else {
    // Linux and others
    command = `xdg-open "${url}"`
  }

  await execAsync(command)
}

/**
 * Perform browser-based login to Xano
 *
 * Opens the user's browser to the Xano login page, waits for the callback
 * with the access token, validates it, and returns the result.
 */
export async function browserLogin(options: BrowserLoginOptions = {}): Promise<BrowserLoginResult> {
  const apiUrl = options.apiUrl || 'https://app.xano.com'
  const timeout = options.timeout || 300_000 // 5 minutes

  // Start callback server
  const { port, server, waitForToken } = await startCallbackServer()
  const callbackUrl = `http://localhost:${port}/callback`

  // Build auth URL
  // Note: Using dest=vscode because Xano's login page recognizes this parameter
  // and will redirect to the callback URL with the access token
  const authUrl = `${apiUrl}/login?dest=vscode&callback=${encodeURIComponent(callbackUrl)}`

  // Track timeout so we can clear it
  let timeoutId: NodeJS.Timeout | undefined

  try {
    // Open browser
    await openBrowser(authUrl)

    // Wait for token with timeout
    const tokenPromise = waitForToken()
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Authentication timeout - no response received')), timeout)
    })

    const accessToken = await Promise.race([tokenPromise, timeoutPromise])

    // Validate token
    const user = await validateToken(accessToken, apiUrl)

    return { accessToken, user }
  } finally {
    // Clear timeout to prevent it from keeping the process alive
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Close all connections and the server
    server.closeAllConnections?.() // Node 18.2+
    server.close()
  }
}
