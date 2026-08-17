# Registers the daily capture as a Windows scheduled task. Run once, from an
# elevated PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File install-task.ps1
#   powershell -ExecutionPolicy Bypass -File install-task.ps1 -At 07:30
#
# Unregister with: Unregister-ScheduledTask -TaskName CarnivalCountdownPush

param(
    [string]$At = "08:00"
)

$projectDir = $PSScriptRoot
$node = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $node -Argument "daily.js" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At $At

# WakeToRun matters most here: a sleeping PC otherwise just skips the day.
# StartWhenAvailable covers the case where it was fully powered off at $At.
$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
    -TaskName "CarnivalCountdownPush" `
    -Description "Screenshots the carnival countdown and delivers it to my phone." `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Registered CarnivalCountdownPush, daily at $At."
Write-Host "Test it now with: Start-ScheduledTask -TaskName CarnivalCountdownPush"
