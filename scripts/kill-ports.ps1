# Giai phong port dashboard (mac dinh 3000, 3001)
$ports = @(3000, 3001)
foreach ($port in $ports) {
  $matches = netstat -ano | findstr ":$port"
  foreach ($line in $matches) {
    if ($line -notmatch 'LISTENING') { continue }
    $processId = ($line -split '\s+')[-1]
    if ($processId -match '^\d+$' -and $processId -ne '0') {
      Write-Host "Killing PID $processId on port $port"
      taskkill /PID $processId /F 2>$null
    }
  }
}
Write-Host "Done."
