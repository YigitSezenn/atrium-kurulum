# Atrium

Yazılım topluluğu için Discord botları. Hepsi aynı makinede durur ve kendi aralarında konuşur. İndiren kişi kendi sunucusuna kurabilir.

| Bot | Discord adı | Ne yapar |
| --- | --- | --- |
| Atrium | Atrium | Müzik, karşılama, seviye, denetim, Valorant, Spotify |
| Arcade | Arcade | Dil ve alan rolleri |
| Source | Source | `/github`, `/dokuman`, depo kartı |
| directory | directory | `/ticket`, yardım başlığı, kısa muhabbet |
| Ward | Ward | Atma ve yasak. Token boşsa bu komutlar Atrium'da kalır |

## Ne lazım

- [Node.js 22](https://nodejs.org/) veya Docker
- Dört Discord uygulaması (her botun kendi tokenı)
- Müzik için botun girebileceği bir ses kanalı

## Discord uygulamaları

1. [Discord Developer Portal](https://discord.com/developers/applications) üzerinden uygulama aç: Atrium, Arcade, Source, directory. Atma ve yasağı ayrı bot yapsın istersen bir tane de Ward.
2. Her uygulamada **Bot** sayfasına gir. **Privileged Gateway Intents** altından **Server Members Intent** ve **Message Content Intent** açık olsun.
3. Her botun tokenını kopyala. Tokenı sohbete, repoya veya ekran görüntüsüne koyma.
4. Botu sunucuya davet et. Adresin sonuna kendi uygulama kimliğini yaz:

```
https://discord.com/api/oauth2/authorize?client_id=UYGULAMA_ID&permissions=8&scope=bot%20applications.commands
```

5. Bot rollerini, dağıtacakları dil rollerinin üstüne al. Yoksa rol veremezler.

## Ayar

`.env.example` dosyasını `.env` yap ve doldur.

```
DISCORD_TOKEN=          Atrium
AGENT_STACK_TOKEN=      Arcade
AGENT_KAYNAK_TOKEN=     Source
AGENT_REHBER_TOKEN=     directory
AGENT_BAN_TOKEN=        Ward, boşsa atma ve yasak Atrium'da kalır
GUILD_ID=               kendi sunucunun kimliği
AGENT_BUS_PORT=47831
```

Boş bırakılabilenler:

- `SPOTIFY_CLIENT_ID` ve `SPOTIFY_CLIENT_SECRET` — `/spotify` için. Spotify uygulamasında yönlendirme adresi `SPOTIFY_REDIRECT_URI` ile aynı olsun.
- `HENRIK_API_KEY` — `/valorant` için. Anahtarı [henrikdev.xyz](https://henrikdev.xyz) üzerinden al.
- `YTDLP_COOKIES` — yaş sınırı olan YouTube videoları için çerez dosyasının yolu.
- `CHAT_API_KEY` — bot sohbeti ve etiket cevapları için. Boşsa hazır replikler kullanılır. Ücretsiz anahtar [console.groq.com](https://console.groq.com) üzerinden alınır. `CHAT_API_EXPIRES` anahtarın bittiği gündür. Süre dolunca veya API anahtarı reddedince bot hazır repliğe döner ve logda yeni anahtar istendiğini yazar. `CHAT_API_BASE` ve `CHAT_MODEL` OpenAI uyumlu başka bir adrese de çevrilebilir.

`.env` repoya girmez.

## Docker ile çalıştır

```powershell
docker compose up -d --build
```

Tek konteyner Atrium'u ve üç ajanı birlikte açar. Kayıtlar `data/` klasöründe durur. Bu klasör de repoya girmez; her kurulum kendi kanal ve rol kimliklerini orada tutar.

Yeni bir imaj aldığında botlar, sürüm değiştiyse duyuru kanalına kendi yama notunu bir kez yazar. Notlar `src/release.js` içindedir.

## Docker olmadan

İki terminal lazım. İkisi de aynı klasörde açık kalsın.

```powershell
npm install
npm start
npm run agents
```

`npm start` Atrium'u açar. `npm run agents` Arcade, Source ve directory'yi açar. Tokenlardan biri boşsa ajanlar kalkmaz; Atrium tek başına devam eder.

## Sunucuyu hazırla

1. Sunucu sahibi `/kurulum` yazar, **onay** seçeneğini evet yapar. Roller ve kanallar oluşur.
2. Kurucu, kanalın yerini değiştirmek isterse `/kanal-ayarla` kullanır. Anahtar ve kanal seçilir. Sunucu sıfırlanmaz.
3. Üye yardım için `/ticket` yazar. Konu ve açıklama yeter.

`/kurulum` içinde `rolleri-sifirla` veya `kanallari-sifirla` seçeneğini açma. İkisi de mevcut rolleri veya kanalları siler.

## Sık kullanılan komutlar

- `/muzik cal` — şarkı çalar. Her yazı kanalından yazılır. Ses kanalı seçilmezse bot, senin olduğun kanala girer.
- `/muzik ekle`, `/muzik liste`, `/muzik liste-cal` — kalıcı şarkı listesi.
- `/spotify login` — Spotify hesabını bağlar.
- `/github` ve `/dokuman` — Source. Projeler, yığın, yardım ve komut kanallarında çalışır.
- `/ticket` — directory yardım başlığı açar. Yardım kartındaki buton da aynı işi yapar. Başlıkta yetkili üstlenir, açan veya yetkili kapatır. Kapanınca döküm yetkili sohbete düşer.
- `/kanal-ayarla` — Kurucu, botun baktığı kanalı değiştirir.
- `/sohbet kapat` ve `/sohbet ac` — Kurucu, botların kendi aralarındaki konuşmasını keser veya açar. Etiketleyince verilen cevap durmaz.
- `/uyar`, `/sustur` — Atrium, yetkili kanalında.
- `/temizle` — bulunduğun yazı kanalındaki son mesajları siler. Her kanalda yazılır.
- `/at` — üyeyi sunucudan atar. Onay butonu sorar. Tekrar davetle girebilir.
- `/yasakla`, `/gecici-yasak`, `/yumusak-yasak`, `/yasak-kaldir`, `/yasaklar` — yetkili kanalında. Süre `30d`, `12s` veya `2g` yazılır. `AGENT_BAN_TOKEN` doluysa bu komutlar Ward botundadır ve o botun rolü hedefin üstünde olmalıdır.
- `/not kaydet`, `/not goster` — sık kullanılan cevabı saklar.
- `/anket soru secenekler` — seçenekleri `|` ile ayır. Herkes bir oy verir.
- `/paket` — Source, npm paketinin sürümünü ve son 7 gündeki indirilmesini yazar.
- Yıldız panosu — Kurucu `/kanal-ayarla` ile `Yıldız panosu` kanalını bağlar. Bir mesaj 3 yıldız alınca oraya düşer.

Bir bota adıyla veya etiketle seslenince kısa cevap verir. Genel kanal uzun süre sessizse kendi aralarında birkaç satır konuşurlar.
