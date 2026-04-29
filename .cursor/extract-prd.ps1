param(
  [string]$Source,
  [string]$Dest
)

if (Test-Path $Dest) {
  Remove-Item -Recurse -Force $Dest
}
New-Item -ItemType Directory -Path $Dest | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($Source, $Dest)

Get-ChildItem -Path $Dest -Recurse | Select-Object -ExpandProperty FullName
