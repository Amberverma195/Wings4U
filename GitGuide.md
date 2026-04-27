# GitHub Push Guide

This project folder is:

```powershell
D:\Projects\Websites\Wings4U\Code
```

If you initialize Git inside this `Code` folder, GitHub will not upload a folder named `Code`. The contents you commit from inside `Code` become the root of the GitHub repository.

## 1. Open the project folder

```powershell
cd D:\Projects\Websites\Wings4U\Code
```

## 2. Initialize Git

Run this only if the folder is not already a Git repository.

```powershell
git init
```

## 3. Connect the GitHub repository

```powershell
git remote add origin https://github.com/Amberverma195/Wings4U.git
```

If `origin` already exists, update it instead:

```powershell
git remote set-url origin https://github.com/Amberverma195/Wings4U.git
```

## 4. Confirm the remote

```powershell
git remote -v
```

You should see:

```text
origin  https://github.com/Amberverma195/Wings4U.git (fetch)
origin  https://github.com/Amberverma195/Wings4U.git (push)
```

## 5. Stage only the files you want to upload

Do not use `git add .` for the first upload. Use explicit paths so extra folders like `.claude`, `.cursor`, `.local`, `db`, `infra`, `node_modules`, and design scratch files are not accidentally committed.

Recommended first upload:

```powershell
git add .gitignore GitGuide.md .editorconfig package.json package-lock.json tsconfig.base.json apps/api apps/print-agent apps/web packages/contracts packages/database packages/pricing
```

The `packages` folders are included because the apps import them:

- `apps/api` depends on `@wings4u/database`.
- `apps/web` depends on `@wings4u/contracts`.
- `packages/pricing` depends on `@wings4u/contracts` and is referenced by the root workspace scripts.

Optional files you can add later:

```powershell
git add README.md .github
```

Add these only if you want the GitHub repo to include the current monorepo README and CI workflow. The current README mentions folders like `Docs`, `infra`, and `ops`, so it may need cleanup if those folders are not uploaded.

## 6. Check what will be committed

```powershell
git status --short
```

For a cleaner file-only list:

```powershell
git diff --cached --name-only
```

Review this list carefully. Only continue if it contains the files you actually want on GitHub.

## 7. Commit the files

```powershell
git commit -m "Initial Wings4U app upload"
```

## 8. Set the branch name

```powershell
git branch -M main
```

## 9. Push to GitHub

```powershell
git push -u origin main
```

## 10. Future updates

After the first push, use this flow for normal updates:

```powershell
git status --short
git add apps/api apps/print-agent apps/web packages/contracts packages/database packages/pricing package.json package-lock.json tsconfig.base.json .editorconfig .gitignore GitGuide.md
git status --short
git commit -m "Describe your change"
git push
```

## Important notes

- `.gitignore` should stay at the root of this `Code` folder because this is where the Git repository will be initialized.
- GitHub only receives files that are committed.
- `node_modules` and `.env` files should not be committed.
- Keep `.env` and `.env.example` files local unless you intentionally want to publish sanitized templates.
- Use `git diff --cached --name-only` before every commit when you want to be extra sure what is about to be uploaded.
