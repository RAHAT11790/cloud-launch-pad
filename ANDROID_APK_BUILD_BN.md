# RS Anime Android APK Build Package

এই package-এ Android Studio/Capacitor APK project structure ready করা আছে।

## গুরুত্বপূর্ণ সত্য

- এই app আপনার existing RS Anime web app-কে native Android shell-এর ভিতরে চালায়।
- Website domain বন্ধ হলেও APK install থাকবে, কিন্তু online video/data/auth/backend যেগুলো internet/backend থেকে আসে সেগুলো backend access ছাড়া 100% guarantee করা যায় না।
- HTTP stream/source allow করার জন্য Android cleartext traffic enabled করা হয়েছে।

## APK বানানোর ধাপ

1. Zip unzip করুন।
2. Terminal/CMD খুলে project folder-এ যান।
3. Run করুন:

```bash
npm install
npm run build
npx cap sync android
```

4. Android Studio দিয়ে `android` folder খুলুন।
5. Build > Generate Signed Bundle / APK থেকে APK বানান।

## Main Android files

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/network_security_config.xml`
- `capacitor.config.ts`
- `src/`, `public/`, `supabase/`

## App info

- App ID: `app.lovable.d9496f6fadd2411c96f8fb97b0c234a7`
- App Name: `rsanime03`
- HTTP/Mixed content: enabled