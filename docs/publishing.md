# Publishing checklist

The repository is in a push-ready state. Creating the remote is a separate, explicit
step — these are the commands for it, kept here so the decision stays deliberate.

## Before the first push

1. `gh auth status` — the account needs `repo` scope (and `delete_repo` if a retraction
   is plausible; a default token does not have it).
2. Re-run the personal-information scan over the whole worktree:

   ```sh
   grep -rInE '(192\.168\.|10\.[0-9]+\.[0-9]+\.|100\.[0-9]+\.[0-9]+\.[0-9]+|\.ts\.net|/Users/[a-z]+/|/home/[a-z]+/|gho_|github_pat_|sk-[A-Za-z0-9]|AKIA|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY)' .
   ```

   Expect only documented placeholders (`<your-host>`, `myhost.example.ts.net`).
3. Check committed images by eye — a text scan cannot see inside a PNG.
4. `git log --format='%an <%ae>%n%b'` — author must be the noreply identity, and no
   `Co-Authored-By`, no session URLs, no tool signatures in the bodies.
5. Confirm `git remote -v` is empty.

## Create the remote (only when asked to publish)

```sh
gh repo create <owner>/dsh-phone-ui --public --source=. --push \
  --description "A phone-only layer for the DSH web UI: slide-over sidebar, 36-40px tap targets, keyboard-aware composer. No patch to the DSH install. (EN/KO/ZH/JA)"
```

Then verify the push landed by reading a file back over the HTTP surface, e.g.

```sh
curl -s https://raw.githubusercontent.com/<owner>/dsh-phone-ui/main/README.md | head -3
```

## After publishing

- Record the publish (repo, date, what was included) in the decisions ledger, area 公開.
- If a retraction is ever needed: `gh repo delete <owner>/<repo> --yes` needs
  `delete_repo`; otherwise use Settings → Danger Zone in the web UI. Keep the local
  clone as the record and remove the remote only after deletion succeeds.
