function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Wait-HttpReady {
    param([string]$Uri, [int]$TimeoutSeconds = 20)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
            if ([int]$response.StatusCode -eq 200) { return $true }
        }
        catch {}
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

$kiwixExecutable = $env:NOCTURNIX_TEST_KIWIX_EXE
$zimPath = $env:NOCTURNIX_TEST_ZIM_PATH
$skipKiwix = -not ($kiwixExecutable -and $zimPath -and (Test-Path -LiteralPath $kiwixExecutable) -and (Test-Path -LiteralPath $zimPath))

Describe 'Kiwix Windows lifecycle integration' {
    It 'exits when its configured attachment process ends' -Skip:$skipKiwix {
        $port = Get-FreeLoopbackPort
        $hostCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep -Seconds 60'))
        $hostProcess = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList '-NoProfile','-EncodedCommand',$hostCommand -WindowStyle Hidden -PassThru
        $kiwixProcess = $null
        try {
            $arguments = @(
                '--address=127.0.0.1',
                "--port=$port",
                "--attachToProcess=$($hostProcess.Id)",
                '--blockexternal',
                ('"{0}"' -f $zimPath)
            )
            $startParameters = @{
                FilePath = $kiwixExecutable
                ArgumentList = $arguments
                WindowStyle = 'Hidden'
                RedirectStandardOutput = (Join-Path $TestDrive 'kiwix.out.log')
                RedirectStandardError = (Join-Path $TestDrive 'kiwix.err.log')
                PassThru = $true
            }
            $kiwixProcess = Start-Process @startParameters
            (Wait-HttpReady -Uri "http://127.0.0.1:$port/viewer") | Should Be $true
            Stop-Process -Id $hostProcess.Id -Force
            $kiwixProcess.WaitForExit(10000) | Should Be $true
            (Get-Process -Id $kiwixProcess.Id -ErrorAction SilentlyContinue) | Should BeNullOrEmpty
        }
        finally {
            Stop-Process -Id $hostProcess.Id -Force -ErrorAction SilentlyContinue
            if ($kiwixProcess) { Stop-Process -Id $kiwixProcess.Id -Force -ErrorAction SilentlyContinue }
        }
    }
}
