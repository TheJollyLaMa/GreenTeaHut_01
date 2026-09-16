const fs = require('fs');

const { githubRequest, repositoryCoordinates } = require('./githubApi');

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const issue = event.issue;
  if (!issue) throw new Error('GitHub issue event payload is required');

  const { owner, repo } = repositoryCoordinates();
  const reviewer = process.env.CONTRIBUTOR_REQUEST_REVIEWER || 'TheJollyLaMa';
  await githubRequest(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: `Thanks for offering technical help. @${reviewer} has been assigned to review the GitHub handle, wallet, requested work, and links in this issue.`,
    }),
  });
  try {
    await githubRequest(`/repos/${owner}/${repo}/issues/${issue.number}/assignees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees: [reviewer] }),
    });
  } catch (error) {
    console.warn(`Could not assign @${reviewer}: ${error.message}`);
  }
  console.log(`Notified @${reviewer} about contributor request #${issue.number}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}