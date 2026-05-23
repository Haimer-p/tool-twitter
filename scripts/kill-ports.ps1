# Giai phong port dashboard (mac dinh 3000, 3001)
$ports = @(3000, 3001)
foreach ($port in $ports) {
  $matches = netstat -ano | findstr ":$port"
  foreach ($line in $matches) {
    if ($line -notmatch 'LISTENING') { continue }
    $pid = ($line -split '\s+')[-1]
    if ($pid -match '^\d+$' -and $pid -ne '0') {
      Write-Host "Killing PID $pid on port $port"
      taskkill /PID $pid /F 2>$null
    }
  }
}
Write-Host "Done."

