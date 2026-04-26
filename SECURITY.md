# Security Policy

Thank you for helping keep **Contract OCR & Renewal Tracker** secure.

## Supported Versions

This project is maintained on a best-effort basis from the default branch.

| Version | Supported |
| --- | --- |
| Latest `main` branch | ✅ |
| Older commits / forks | ❌ |

## Reporting a Vulnerability

If you discover a security issue, please report it privately.

- **Preferred contact:** open a private security advisory or contact the project maintainers directly.
- **Please do not** open a public GitHub issue with exploit details.
- Include as much detail as possible:
  - A description of the vulnerability and impact.
  - Steps to reproduce (proof of concept if possible).
  - Affected endpoints, files, or configuration.
  - Any suggested remediation.

## What to Expect

When you submit a report, maintainers will aim to:

1. Acknowledge receipt within **5 business days**.
2. Validate and triage the report.
3. Work on a fix and coordinate disclosure timing.
4. Credit the reporter (if desired) once a fix is released.

Response times may vary based on maintainer availability.

## Scope & Hardening Notes

Areas that commonly affect security in this project include:

- Authentication/session settings (for example `AUTH_REQUIRED`, `AUTH_COOKIE_SECURE`).
- OIDC configuration and secret handling (`OIDC_CLIENT_SECRET`, related env vars).
- Uploaded contract processing (OCR pipeline, file handling).
- HTTPS/TLS deployment configuration.

For production deployments:

- Always run behind HTTPS with trusted certificates.
- Keep secrets in environment variables or a secret manager (never commit secrets).
- Restrict network exposure of API/UI services.
- Keep dependencies and OCR tooling (Tesseract/Poppler) up to date.

## Safe Harbor

We support good-faith security research. Please:

- Avoid privacy violations, service disruption, or data destruction.
- Test only against systems you own or are authorized to test.
- Provide reasonable time for remediation before public disclosure.
