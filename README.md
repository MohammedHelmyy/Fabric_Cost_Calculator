# Fabric Cost Calculator

The calculator runs as a Cloudflare Pages site. It saves edits as a local draft and publishes shared settings to `settings.json` in the GitHub repository only after an approved user selects **Publish settings**.

## Deploy the site

1. In Cloudflare, create a Pages project connected to `MohammedHelmyy/Fabric_Cost_Calculator`.
2. Select `main` as the production branch, use the repository root, set the build command to `npm run build`, and set the output directory to `dist`.
3. Deploy once and note the production address, for example `https://<project>.pages.dev`. This is the address to use on both laptop and mobile. The existing GitHub Pages address does not run the publishing API.

## Create the GitHub App

Create a GitHub App from the account that owns the repository. Use the Cloudflare Pages address for the homepage and set the callback URL to:

`https://<project>.pages.dev/api/auth/callback`

Grant **Contents: Read and write** repository permission. Install the app on **Only select repositories**, and select `Fabric_Cost_Calculator`. No webhook is required. Keep the generated private key private.

After installing the app, get its installation ID from the installation page URL under GitHub Settings > Applications > Installed GitHub Apps > Configure. The numeric part of that URL is the installation ID. If `main` has branch protection that blocks direct app commits, allow the installed app to update `settings.json` or publishing will be rejected by GitHub.

## Configure Cloudflare

In the Pages project, add these production environment variables:

| Name | Value |
| --- | --- |
| `APP_ORIGIN` | The exact production Pages address, including `https://` |
| `ALLOWED_GITHUB_USERS` | `MohammedHelmyy` (comma-separate any other approved GitHub usernames) |
| `GITHUB_OWNER` | `MohammedHelmyy` |
| `GITHUB_REPO` | `Fabric_Cost_Calculator` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_APP_ID` | The GitHub App ID |
| `GITHUB_APP_CLIENT_ID` | The GitHub App client ID |
| `GITHUB_INSTALLATION_ID` | The installation ID for this repository |

Add these as **encrypted secrets**, not regular variables:

| Name | Value |
| --- | --- |
| `GITHUB_APP_CLIENT_SECRET` | The GitHub App client secret |
| `GITHUB_APP_PRIVATE_KEY` | The GitHub App private key PEM |
| `SESSION_SECRET` | A new random secret with at least 32 characters |

Generate a session secret locally in PowerShell with:

```powershell
$bytes = New-Object byte[] 32
([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Enter that value directly in Cloudflare and do not share it in chat or commit it. Configure secrets for the **production** environment only, then redeploy the Pages project after adding or changing variables.

## Publishing behavior

- GitHub sign-in allows only usernames in `ALLOWED_GITHUB_USERS`.
- The backend uses the GitHub App installation, scoped to this repo, to update only `settings.json` on `main`.
- GitHub retains each settings update as a commit. Cloudflare Pages redeploys after the commit; the settings API can read the new values immediately.
- If another edit was published after the current page loaded, publishing is rejected. Select **Load published**, review the latest values, then make and publish changes again.
- This repository is public, so published fabrics, process names, and prices are public. Do not store confidential pricing here.

## Local use

Opening `index.html` directly continues to work with browser-local storage. GitHub sign-in and publishing are available only on the configured Cloudflare Pages address.