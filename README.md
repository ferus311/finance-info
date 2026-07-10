This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
```

- lệnh chạy tailscale

``` bash
- tailscale funnel --https=443 off
- sudo tailscale funnel --bg 3000

```
- lệnh chạy tmux

``` bash
- tmux new -s <tên_session>	Tạo một session mới với tên tùy chọn (VD: tmux new -s backend)
- tmux ls	Liệt kê tất cả các session đang chạy ngầm
- tmux a -t <tên_session>	Nhảy vào lại (Attach) một session đang chạy ngầm
- tmux kill-session -t <tên_session>	Xóa hẳn một session (tắt toàn bộ app bên trong nó)
- tmux rename-session -t <tên_cũ> <tên_mới>	Đổi tên session


- tmux new -s finance-frontend
- cd /home/fong/project_ai/finance-info
- pnpm run build
- pnpm start -H 0.0.0.0

- Ấn cụm Ctrl + b, sau đó thả tay ra.
- Ấn tiếp phím d (viết tắt của Detach).
```
