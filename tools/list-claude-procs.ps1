# Diagnostic: list claude.exe processes, separating "my Claude Code session"
# from orphans. ASCII only -- Windows PowerShell 5.1 reads .ps1 as ANSI.
# NEVER kill by image name; use this list to kill by PID.

$ancestors = @()
$cur = $PID
for ($i = 0; $i -lt 20; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $ancestors += [int]$p.ProcessId
    $cur = [int]$p.ParentProcessId
    if (-not $cur -or $cur -eq 0) { break }
}

Write-Output "== ANCESTOR CHAIN (NEVER KILL) =="
Get-CimInstance Win32_Process | Where-Object { $ancestors -contains [int]$_.ProcessId } |
    ForEach-Object { "  PID $($_.ProcessId)  $($_.Name)" }

Write-Output ""
Write-Output "== ALL claude.exe =="
Write-Output ("{0,-8} {1,-8} {2,-16} {3,-7} {4,-8} {5}" -f 'PID', 'PPID', 'PARENT', 'MINE', 'MEM_MB', 'STARTED')

$all = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Sort-Object CreationDate
foreach ($proc in $all) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
    $parentName = if ($parent) { $parent.Name } else { '(gone)' }
    $isAnc = if ($ancestors -contains [int]$proc.ProcessId) { 'YES' } else { '' }
    $mb = [math]::Round($proc.WorkingSetSize / 1MB)
    Write-Output ("{0,-8} {1,-8} {2,-16} {3,-7} {4,-8} {5}" -f `
        $proc.ProcessId, $proc.ParentProcessId, $parentName, $isAnc, $mb, $proc.CreationDate)
}

Write-Output ""
Write-Output "== ORPHAN CANDIDATES (parent gone AND not my ancestor) =="
$orphans = @()
foreach ($proc in $all) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
    if ((-not $parent) -and ($ancestors -notcontains [int]$proc.ProcessId)) { $orphans += $proc }
}
if ($orphans.Count -gt 0) {
    foreach ($o in $orphans) { "  PID $($o.ProcessId)  $([math]::Round($o.WorkingSetSize/1MB))MB  $($o.CreationDate)" }
    Write-Output ""
    Write-Output "PIDS=$(($orphans | ForEach-Object { $_.ProcessId }) -join ',')"
} else {
    Write-Output "  none"
    Write-Output "PIDS="
}
