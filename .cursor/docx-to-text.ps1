param(
  [string]$Source,
  [string]$Dest
)

$xml = [xml](Get-Content -Path $Source -Raw -Encoding UTF8)
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")

$sb = New-Object System.Text.StringBuilder
foreach ($p in $xml.SelectNodes("//w:p", $ns)) {
  foreach ($t in $p.SelectNodes(".//w:t", $ns)) {
    [void]$sb.Append($t.InnerText)
  }
  [void]$sb.AppendLine()
}

Set-Content -Path $Dest -Value $sb.ToString() -Encoding UTF8
Write-Host "Wrote $($sb.Length) chars to $Dest"
