const fs = require('fs');
const path = require('path');

// Kiểm tra xem file icon.ico hiện tại có đúng format không
const iconPath = path.join(__dirname, 'build', 'icon.ico');
const pngPath = path.join(__dirname, 'build', 'icon.png');

// Đọc file và kiểm tra header
if (fs.existsSync(iconPath)) {
    const buffer = fs.readFileSync(iconPath);
    console.log('=== Kiểm tra file icon.ico ===');
    console.log('Kích thước file:', buffer.length, 'bytes');
    console.log('Header bytes (6 đầu tiên):', buffer.slice(0, 6).toString('hex'));
    
    // ICO file phải bắt đầu bằng: 00 00 01 00
    const isValidIco = buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00;
    console.log('Là file ICO hợp lệ:', isValidIco);
    
    if (!isValidIco) {
        // Kiểm tra xem có phải file PNG không
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        if (isPng) {
            console.log('File này thực chất là file PNG, không phải ICO!');
            console.log('Bạn cần convert file PNG sang ICO đúng cách.');
        }
    }
}

if (fs.existsSync(pngPath)) {
    const buffer = fs.readFileSync(pngPath);
    console.log('\n=== Kiểm tra file icon.png ===');
    console.log('Kích thước file:', buffer.length, 'bytes');
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    console.log('Là file PNG hợp lệ:', isPng);
}

console.log('\n=== Hướng dẫn ===');
console.log('Để tạo file icon.ico đúng cách:');
console.log('1. Truy cập: https://convertico.com/ hoặc https://icoconvert.com/');
console.log('2. Upload file icon.png');
console.log('3. Chọn các kích thước: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256');
console.log('4. Tải file .ico về và đặt vào thư mục build/');
console.log('\nHoặc sử dụng ImageMagick:');
console.log('magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico');
