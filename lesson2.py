import ee
import geemap

# GEE ကို စတင်ချိတ်ဆက်ခြင်း (Project ID ထည့်ပါ)
ee.Initialize(project='urban-heat-island-yangon')

# ၁။ ရန်ကုန်မြို့၏ တည်နေရာ (Geometry / Region) ကို သတ်မှတ်ခြင်း
# ရန်ကုန်မြို့ဝန်းကျင်၏ ဧရိယာ (Longitude, Latitude)
yangon_geom = ee.Geometry.Polygon([
    [[96.0, 16.7], [96.3, 16.7], [96.3, 17.0], [96.0, 17.0]]
])

# ၂။ Landsat 8 သို့မဟုတ် 9 စုစည်းထားသော ဒေတာကို ခေါ်ယူခြင်း (မကြာသေးမီက ရိုက်ကူးထားသော Cloud နည်းသည့် ပုံများ)
collection = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
              .filterBounds(yangon_geom)
              .filterDate('2024-01-01', '2024-12-31')
              .sort('CLOUD_COVER')
              .first())

# ၃. အပူချိန် (Land Surface Temperature) တွက်ချက်ရန်အတွက် Thermal Band ကို ရယူခြင်း (ST_B10)
# ရိုးရှင်းသော Visualisation အတွက် B10 ကို အသုံးပြုပါမည်
thermal_band = collection.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15) # Kelvin မှ Celsius သို့ ပြောင်းရန်

# ၄. မြေပုံပေါ်တွင် ဖော်ပြရန် (Map Visualization)
Map = geemap.Map(center=[16.8409, 96.1735], zoom=11)

# အပူချိန်အတွက် အရောင်သတ်မှတ်ချက် (အေးသောနေရာ အပြာ၊ ပူသောနေရာ အနီ/လိမ္မော်)
thermal_viz = {
    'min': 20,
    'max': 45,
    'palette': ['blue', 'cyan', 'green', 'yellow', 'orange', 'red']
}

Map.addLayer(thermal_band.clip(yangon_geom), thermal_viz, 'Yangon Land Surface Temperature (C)')
Map.addLayerControl()

# HTML ဖိုင်အဖြစ် ထုတ်ယူခြင်း (သို့မဟုတ် Display လုပ်ခြင်း)
Map.to_html('yangon_heat_map.html')
print("Heat map generated successfully! Open 'yangon_heat_map.html' in your browser.")