export function UploadTool() {
  return (
    <div>
      <h3>CLI Upload Tool</h3>
      <p className="hint">
        For bulk imports, a command-line tool can mirror a whole local folder tree into Swordthain and upload
        everything inside it — recursively, with real concurrency, and resumable large-file uploads. It signs in
        the same way as this web app and uses the same API, so nothing new is exposed.
      </p>

      <h4>Setup</h4>
      <p className="hint">Requires Node.js 20+. In the project repo:</p>
      <pre className="code-block">{"cd apps/media-app-cli\nnpm install"}</pre>

      <h4>First run</h4>
      <p className="hint">
        You'll be asked for your email, then the 6-digit code sent to it — the same sign-in as this app. After
        that, it stays signed in on its own for up to a year.
      </p>

      <h4>Example</h4>
      <pre className="code-block">{'npx tsx src/cli.ts ~/Movies/"Rhodes 2024" --parent "Family Videos"'}</pre>

      <h4>Options</h4>
      <table className="matrix">
        <thead>
          <tr>
            <th>Flag</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>--parent &lt;title&gt;</code>
            </td>
            <td>Remote parent folder to mirror into (default: root). Supports nested paths, e.g. "Family/2026".</td>
          </tr>
          <tr>
            <td>
              <code>--concurrency &lt;n&gt;</code>
            </td>
            <td>Parallel file uploads (default: 4).</td>
          </tr>
          <tr>
            <td>
              <code>--dry-run</code>
            </td>
            <td>Show the folder/upload plan without creating or uploading anything.</td>
          </tr>
          <tr>
            <td>
              <code>--email &lt;address&gt;</code>
            </td>
            <td>Skip the interactive email prompt on first sign-in.</td>
          </tr>
        </tbody>
      </table>

      <p className="hint">
        Session cache lives at <code>~/.swordthain-cli/</code>. Full details in the tool's own{" "}
        <code>apps/media-app-cli/README.md</code>.
      </p>
    </div>
  );
}
