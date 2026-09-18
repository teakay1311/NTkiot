# NTKIOT

NTKIOT là ứng dụng quản lý bán hàng offline trên máy tính, hỗ trợ sản phẩm, tồn kho, hóa đơn, khách hàng, nhà cung cấp, nhập hàng, đổi trả, in hóa đơn và sao lưu dữ liệu cục bộ.

## Đặc điểm

- Hoạt động offline, không yêu cầu backend hoặc kết nối mạng khi sử dụng.
- Dữ liệu nghiệp vụ được lưu cục bộ trên máy người dùng.
- Quản lý sản phẩm, danh mục, tồn kho và lịch sử kho.
- Quản lý hóa đơn, khách hàng, nhà cung cấp, đơn nhập hàng và đổi trả.
- In hóa đơn, xuất dữ liệu và sao lưu/khôi phục dữ liệu.
- Phân quyền tài khoản quản trị, quản lý và nhân viên.

## Yêu cầu

- Node.js có sẵn `npm`.
- Electron và các dependency được cài từ `package-lock.json`.

## Cài đặt và chạy

```bash
npm ci
npm start
```

## Kiểm tra source

```bash
npm test
npm run doctor
```

## Tài khoản mặc định

```text
Username: admin
Password: 123
```

Đây là tài khoản khởi tạo mặc định. Hãy đăng nhập và đổi mật khẩu ngay sau lần sử dụng đầu tiên, đặc biệt khi chia sẻ source hoặc bộ cài đặt.

## Build Windows

```bash
npm run build:win
```

Hướng dẫn chi tiết nằm trong [HUONG_DAN_BUILD_WINDOWS.md](HUONG_DAN_BUILD_WINDOWS.md).

Các file build trong `dist/` không được commit vào source repository. Bộ cài đặt có thể được phát hành riêng bằng GitHub Release.

## License

Copyright (c) 2026 Nguyễn Thành Kiên

This project is licensed under the MIT License. See [LICENSE](LICENSE).
