#!/usr/bin/env bash
# Fixture WordPress matriks widget: WordPress terbaru (tema blok bawaan) + plugin Plasgos CRM dari repo tetangga.
#   PLASGOS_WORDPRESS_DIR  folder plugin (bawaan ../plasgos-wordpress dari akar repo ini); butuh vendor-prefixed/
#                          (`composer install` di folder plugin).
# Tetap berjalan (log WordPress) sampai dihentikan Playwright; saat berhenti kontainer & volume dibuang.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
export PLASGOS_WORDPRESS_DIR="$(cd "${PLASGOS_WORDPRESS_DIR:-$root/../plasgos-wordpress}" && pwd)"
if [ ! -f "$PLASGOS_WORDPRESS_DIR/vendor-prefixed/autoload.php" ]; then
  echo "Plugin belum dibangun: jalankan 'composer install' di $PLASGOS_WORDPRESS_DIR" >&2
  exit 1
fi
cd "$(dirname "$0")"
dc() { docker compose "$@"; }
wp() { dc exec -T cli wp "$@"; }
cleanup() { [ "${KEEP:-0}" = "1" ] || dc down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

dc up -d --quiet-pull
for _ in $(seq 1 90); do
  if dc exec -T cli test -f /var/www/html/wp-config.php 2>/dev/null && wp db check >/dev/null 2>&1; then break; fi
  sleep 2
done
wp core install --url=http://localhost:4518 --title="Toko WordPress" --admin_user=admin --admin_password=admin --admin_email=admin@contoh.id --skip-email >/dev/null
wp rewrite structure '/%postname%/' >/dev/null
wp plugin activate plasgos-crm >/dev/null
wp option update plasgos_crm_webchat '{"enabled":true,"identify_users":true,"placement":"all","whatsapp_button":"hide"}' --format=json >/dev/null
product=$(wp post create --post_type=page --post_status=publish --post_title=Produk --post_name=produk \
  --post_content='<!-- wp:paragraph --><p>Kain tulis motif parang.</p><!-- /wp:paragraph --><!-- wp:shortcode -->[plasgos_webchat label="Tanya stok"]<!-- /wp:shortcode -->' --porcelain)
wp post create --post_type=page --post_status=publish --post_title=Beranda --post_name=beranda \
  --post_content="<!-- wp:paragraph --><p><a id=\"ke-produk\" href=\"/produk/\">Lihat produk</a></p><!-- /wp:paragraph -->" --porcelain >/dev/null
wp option update show_on_front page >/dev/null
wp option update page_on_front "$(wp post list --post_type=page --name=beranda --field=ID)" >/dev/null
# Baris ini = tanda siap bagi Playwright (`wait.stdout`). Bukan URL: WordPress yang belum terpasang menjawab semua URL
# dengan redirect ke install.php, dan pemeriksa URL menganggap 3xx sudah siap.
echo "WordPress siap di http://localhost:4518 (produk #$product)"
dc logs -f wordpress
