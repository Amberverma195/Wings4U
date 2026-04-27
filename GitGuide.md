# GitHub Update Guide

Use this guide after the first GitHub upload is already done.

Project folder:

```powershell
D:\Projects\Websites\Wings4U\Code
```

## 1. Open the project folder

```powershell
cd D:\Projects\Websites\Wings4U\Code
```

## 2. Check what changed

```powershell
git status --short
```

Look at this list before staging anything. Files marked `??` are untracked.

## 3. Stage only the changes you want to upload

For changes in the main app folders, use:

```powershell
git add apps/api apps/web apps/print-agent
```

If your change also touched shared packages, add them too:

```powershell
git add packages/contracts packages/database packages/pricing
```

If your change touched root config files, add only the specific files you edited:

```powershell
git add package.json package-lock.json tsconfig.base.json .gitignore .gitattributes .editorconfig GitGuide.md
```

Avoid `git add .` unless you have carefully checked that every new and changed file should go to GitHub.

## 4. Review exactly what will be committed

```powershell
git diff --cached --name-only
```

If something is staged by mistake, unstage it:

```powershell
git restore --staged path/to/file
```

For example:

```powershell
git restore --staged wings4u_order_mode_designs.html
```

## 5. Commit your changes

Use a short message that describes what changed:

```powershell
git commit -m "Update menu page"
```

More examples:

```powershell
git commit -m "Fix auth redirect toast"
git commit -m "Update API order guard"
git commit -m "Improve print agent drawer handling"
```

## 6. Push to GitHub

```powershell
git push
```

If Git says the remote has changes you do not have locally, run:

```powershell
git pull --rebase
git push
```

## Quick flow

Most of the time, this is enough:

```powershell
cd D:\Projects\Websites\Wings4U\Code
git status --short
git add apps/api apps/web apps/print-agent packages/contracts packages/database packages/pricing
git diff --cached --name-only
git commit -m "Describe your change"
git push
```

## Safety notes

- Do not commit `.env`, `.env.example`, `.env.local`, or any real secrets.
- Do not commit `node_modules`, `.next`, `dist`, logs, or build/cache files.
- Be careful with local-only folders like `.claude`, `.cursor`, `Cmds`, `db`, `infra`, `ops`, and design scratch files.
- Use `git status --short` and `git diff --cached --name-only` before every commit.
