# Code signing policy

## Release signing

Free code signing is provided by SignPath.io; the certificate is issued to
SignPath Foundation. Only Harbor Player Windows artifacts published in GitHub
Releases for the
[`grouzdev/harbor-player`](https://github.com/grouzdev/harbor-player)
repository are considered signed releases.

Only reproducible GitHub Actions builds from stable `vX.Y.Z` tags are signed.
Each signing request requires manual approval and is restricted to this
repository, its GitHub-hosted runners, and approved artifact configurations.

Project roles:

- Author and committer: the owner of the `grouzdev` GitHub repository.
- Reviewer: `grouzdev` reviews changes from contributors without direct write
  access before merging.
- Approver: `grouzdev` reviews the commit and tag for every release request
  and approves the protected `stable` environment before signing.

All people with these roles must use multi-factor authentication for GitHub and
SignPath. Third-party executables, closed-source components, and artifacts
built outside the approved workflow are not signed.

## Privacy and network access

Harbor Player stores its catalog, operation log, artwork, and recovery data
locally on the user's computer. The application does not send them to a cloud
service.

The installed desktop version checks GitHub Releases for updates 30 seconds
after startup and then every six hours. It sends GitHub ordinary HTTPS request
data, including the IP address; installer download starts only after the user
selects the Download button. The portable version does not check for updates in
the background and opens the Releases page only on explicit user request.

MusicBrainz search runs only after the user selects Search: the service receives
the title and artist entered by the user. After a release is selected, the
application may request its artwork from Cover Art Archive. Results are cached
locally. All other catalog work, playback, editing, and file operations require
no network access.

Third-party policies: [GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement),
[MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API), and
[Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive).

## System changes and uninstallation

The NSIS installer installs the application for the current user only and
creates shortcuts on the desktop and in the Start menu. It can be uninstalled
through standard Windows controls and does not remove the user's data directory.
