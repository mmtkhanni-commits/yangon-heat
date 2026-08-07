# Deploying the Yangon UHI dashboard

## 1. Install Git

Not installed yet on this machine. Download from https://git-scm.com/download/win and
accept the default options. Close and reopen your terminal afterwards, then check:

```powershell
git --version
```

## 2. Protect your secrets first

Before anything is pushed anywhere, make sure `.gitignore` in the project root contains:

```
.streamlit/secrets.toml
.streamlit/gee-key.json
data/
__pycache__/
*.pyc
```

Neither key file should ever reach GitHub. If one already has, revoke the key and issue a new one.

## 3. Push to GitHub

Create an empty repository on github.com (no README, no .gitignore), then:

```powershell
cd C:\Users\hp\Downloads\UHI_Project
git init
git add .
git commit -m "Yangon urban heat island dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Check on GitHub that `secrets.toml` and `gee-key.json` are **not** listed.

## 4. Deploy on Streamlit Community Cloud

1. Sign in at https://share.streamlit.io with the GitHub account.
2. Create app → pick the repository, branch `main`, main file `app.py`.
3. Open **Advanced settings → Secrets** before deploying and paste:

```toml
GROQ_API_KEY = "gsk_your_new_key"
GEE_PROJECT = "yangon-uhi"

GEE_SERVICE_ACCOUNT_JSON = '''
paste the entire contents of gee-key.json here
'''
```

4. Deploy. The first build takes a few minutes while it installs `requirements.txt`.

## 5. Earth Engine on the server

The server has no `gee-key.json` file, so the app needs the key from secrets. Add this to
`init_earth_engine()` before the file check, and the same function will work in both places:

```python
raw_json = None
try:
    raw_json = st.secrets.get("GEE_SERVICE_ACCOUNT_JSON")
except Exception:
    pass

if raw_json and not os.path.exists(key_path):
    key_path = os.path.join(tempfile.gettempdir(), "gee-key.json")
    with open(key_path, "w", encoding="utf-8") as f:
        f.write(raw_json)
```

## What changes once it is deployed

The SQLite database lives on the server's disk, which Streamlit Community Cloud wipes on
every restart or redeploy. Citizen reports and the observation log will not survive that.
For anything you need to keep, move the two tables to a hosted Postgres database —
Supabase and Neon both have free tiers, and the `get_db()` helper is the only function
that needs to change.

## Running locally

```powershell
cd C:\Users\hp\Downloads\UHI_Project
pip install -r requirements.txt
streamlit run app.py
```
