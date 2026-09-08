# Tailscale CLI Cheat Sheet: Từ Setup đến Public Port (Funnel)

Hướng dẫn tra cứu nhanh các lệnh Tailscale từ giai đoạn cài đặt, chia sẻ nội bộ (*Serve*) cho tới mở cổng công khai ra toàn bộ Internet (*Funnel*).

---

## 1. Khởi tạo & Quản lý Kết nối

### Đăng nhập & kết nối vào Tailnet
```bash
sudo tailscale up
```
*Tác dụng:* Xác thực thiết bị và đưa máy vào mạng riêng ảo (Tailnet).

### Kiểm tra trạng thái mạng
```bash
tailscale status
```
*Tác dụng:* Xem danh sách các node đang online, địa chỉ IP nội bộ (`100.x.y.z`), kiểm tra trạng thái hết hạn của node key.

### Lấy IP Tailscale của máy hiện tại
```bash
tailscale ip -4
```
*Tác dụng:* Trả về nhanh địa chỉ IPv4 nội bộ Tailnet của máy.

---

## 2. Kiểm tra Dịch vụ Local (Pre-check)

Trước khi cấu hình forward port, đảm bảo ứng dụng local (ví dụ Next.js / FastAPI) đang hoạt động:

```bash
# Kiểm tra tiến trình đang lắng nghe port (ví dụ port 3000)
sudo ss -tulpn | grep 3000

# Hoặc dùng lsof
sudo lsof -i :3000

# Test trực tiếp phản hồi nội bộ
curl -I http://127.0.0.1:3000
```

---

## 3. Chia sẻ Nội bộ Tailnet (Tailscale Serve)

Dùng khi chỉ muốn các thiết bị **trong cùng tài khoản Tailscale** truy cập được.

### Map port local vào domain nội bộ (Chạy ngầm)
```bash
tailscale serve --bg 3000
```
*Tác dụng:* Chuyển tiếp cổng 3000 thành endpoint HTTPS nội bộ (ví dụ: `https://<node-name>.<tailnet-name>.ts.net/`).

### Kiểm tra trạng thái Serve
```bash
tailscale serve status
```

---

## 4. Mở Cổng Công khai Toàn cầu (Tailscale Funnel)

Dùng khi muốn **bất kỳ ai ngoài Internet** (không cài Tailscale, dùng 4G/mạng ngoài) đều truy cập được.

### Điều kiện tiên quyết (Admin Console):
1. **DNS Tab:** Bật **HTTPS Certificates**.
2. **Access Controls (ACL):** Khai báo quyền `funnel` trong `nodeAttrs`:
   ```json
   "nodeAttrs": [
     {
       "target": ["*"],
       "attr": ["funnel"]
     }
   ]
   ```

### Cấp phát chứng chỉ SSL (Let's Encrypt)
```bash
sudo tailscale cert <node-name>.<tailnet-name>.ts.net
```
*Tác dụng:* Đăng ký SSL và kích hoạt việc publish bản ghi DNS public trên Name Server toàn cầu.

### Mở public port 3000 qua cổng HTTPS 443 (Chạy ngầm)
```bash
sudo tailscale funnel --bg --https=443 3000
```
*Tác dụng:* Public cổng 3000 ra Internet tại địa chỉ `https://<node-name>.<tailnet-name>.ts.net/`.

### Kiểm tra trạng thái Funnel
```bash
tailscale funnel status
```

---

## 5. Kiểm tra & Chẩn đoán Lỗi (Troubleshooting)

### Kiểm tra phân giải DNS công cộng (từ máy ngoài hoặc dùng DNS 8.8.8.8)
```bash
nslookup <node-name>.<tailnet-name>.ts.net 8.8.8.8
```
*Nếu trả về IP public (`103.x.x.x`, `143.x.x.x`...): DNS đã thông toàn cầu.*

### Test HTTP response từ máy ngoài
```bash
curl -IL https://<node-name>.<tailnet-name>.ts.net/
```

---

## 6. Tắt Cổng & Reset Cấu hình

### Tắt tính năng Funnel (vẫn giữ Serve nội bộ)
```bash
sudo tailscale funnel --https=443 off
```

### Xóa sạch toàn bộ cấu hình Serve & Funnel
```bash
sudo tailscale serve reset
```

### Khởi động lại Tailscale daemon (khi bị đứt phiên/stale tunnel)
```bash
sudo systemctl restart tailscaled
```
