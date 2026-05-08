param(
    [Parameter(Mandatory)]
    [string]$IssueNumber,

    [Alias('b')]
    [string]$Branch
)

$issueTitle = gh issue view $IssueNumber --json title --jq '.title'

if (-not $Branch) {
    $Branch = git branch --show-current
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$prompt = (Get-Content "$scriptDir\review-prompt.md" -Raw)
$prompt = $prompt.Replace('{{ISSUE_NUMBER}}', $IssueNumber)
$prompt = $prompt.Replace('{{ISSUE_TITLE}}', $issueTitle)
$prompt = $prompt.Replace('{{BRANCH}}', $Branch)

claude --permission-mode acceptEdits $prompt
