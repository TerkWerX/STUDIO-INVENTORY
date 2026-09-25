# Security Policy

## Supported version

Security fixes target the latest published release.

## Report a vulnerability

Use GitHub's **Report a vulnerability** option on the repository Security page. Please include the affected version, impact, reproduction steps, and any suggested mitigation. Do not include real inventory data, credentials, license keys, receipts, or private network details.

If private reporting is unavailable, open a public issue containing only a request for private contact—do not disclose exploit details there.

## Deployment boundary

Studio Inventory is intended for a trusted local network. Do not expose port `3847` directly to the internet. Use an owner PIN for remote devices and trusted HTTPS or VPN access when traffic leaves a private network.

- The server answers only to `localhost`, IP addresses, the computer's own name, single-word LAN names, and `.local`/`.lan`/`.home`/`.internal` names. If you reach it through another host name (for example an HTTPS reverse proxy), list that name in the `STUDIO_ALLOWED_HOSTS` environment variable, comma-separated.
- Requests that arrive through a proxy on the studio computer are treated as remote and need the owner PIN.
