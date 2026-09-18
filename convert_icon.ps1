$path = "c:\Users\kiennt\Desktop\ỨNG DỤNG BÁN HÀNG"
Set-Location -LiteralPath $path

# Clean up messy filenames
if (Test-Path "icon.png.png") { 
    Write-Host "Renaming icon.png.png to icon.png"
    Move-Item "icon.png.png" "icon.png" -Force 
}
if (Test-Path "icon.ico.ico") { 
    Write-Host "Removing icon.ico.ico"
    Remove-Item "icon.ico.ico" -Force 
}

# Convert PNG to ICO
try {
    Add-Type -AssemblyName System.Drawing
    $pngPath = "$path\icon.png"
    
    if (Test-Path $pngPath) {
        $img = [System.Drawing.Bitmap]::FromFile($pngPath)
        
        # Create build dir if missing
        if (!(Test-Path "build")) { New-Item "build" -ItemType Directory }
        
        $icoPath = "$path\build\icon.ico"
        $fs = [System.IO.File]::Create($icoPath)
        
        # Simple ICO header writing (IconDir)
        # 0-1: Reserved (0)
        # 2-3: Type (1 = ICO)
        # 4-5: Count (1 image)
        $fs.WriteByte(0); $fs.WriteByte(0)
        $fs.WriteByte(1); $fs.WriteByte(0)
        $fs.WriteByte(1); $fs.WriteByte(0)
        
        # Image Entry
        $width = $img.Width
        $height = $img.Height
        if ($width -ge 256) { $width = 0 }
        if ($height -ge 256) { $height = 0 }
        
        $fs.WriteByte($width)
        $fs.WriteByte($height)
        $fs.WriteByte(0) # Color palette
        $fs.WriteByte(0) # Reserved
        $fs.WriteByte(1); $fs.WriteByte(0) # Planes
        $fs.WriteByte(32); $fs.WriteByte(0) # BPP compression
        
        # Image data size
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $len = $ms.Length
        $ms.Close()
        
        $fs.WriteByte($len -band 0xFF)
        $fs.WriteByte(($len -shr 8) -band 0xFF)
        $fs.WriteByte(($len -shr 16) -band 0xFF)
        $fs.WriteByte(($len -shr 24) -band 0xFF)
        
        # Offset (6 + 16 = 22)
        $fs.WriteByte(22); $fs.WriteByte(0); $fs.WriteByte(0); $fs.WriteByte(0)
        
        # Write Image Data
        $img.Save($fs, [System.Drawing.Imaging.ImageFormat]::Png)
        
        $fs.Close()
        $img.Dispose()
        Write-Host "Success: Created build/icon.ico"
    } else {
        Write-Host "Error: icon.png not found"
    }
} catch {
    Write-Host "Error converting icon: $_"
}
