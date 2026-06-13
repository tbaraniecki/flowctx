import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const CA_DIR = path.join(homedir(), '.mitmproxy')
const CERT_PATH = path.join(CA_DIR, 'certs', 'ca.pem')

export async function setupCert(): Promise<void> {
  // http-mitm-proxy generates its CA at <sslCaDir>/certs/ca.pem on first listen.
  if (!existsSync(CERT_PATH)) {
    console.log('Generating proxy CA certificate...')
    const { Proxy } = await import('http-mitm-proxy')
    const proxy = new Proxy()
    await new Promise<void>((resolve, reject) => {
      proxy.listen({ port: 18181, sslCaDir: CA_DIR }, (err?: Error | null) => {
        proxy.close()
        if (err) reject(err)
        else resolve()
      })
    })
  }

  if (!existsSync(CERT_PATH)) {
    console.error(`Could not generate certificate at ${CERT_PATH}. Check ${CA_DIR}/`)
    process.exit(1)
  }

  // Idempotency check: the CA's common name is "NodeMITMProxyCA".
  try {
    execSync('security find-certificate -c "NodeMITMProxyCA" /Library/Keychains/System.keychain', {
      stdio: 'ignore',
    })
    console.log('Certificate already trusted.')
    return
  } catch {
    // not found, proceed to trust
  }

  console.log('Trusting CA certificate (requires sudo)...')
  execSync(
    `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CERT_PATH}"`,
    { stdio: 'inherit' }
  )
  console.log('Certificate trusted. Please restart Chrome.')
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  setupCert()
}
