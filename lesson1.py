import ee
import geemap

# ၁။ Google Earth Engine သို့ Login ဝင်ရန် Authenticate လုပ်ခြင်း
ee.Authenticate()

# ၂။ Project ID ဖြင့် Earth Engine ကို စတင်ခြင်း
ee.Initialize(project='urban-heat-island-yangon')

print("Google Earth Engine Successfully Connected!")