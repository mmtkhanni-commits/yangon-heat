import ee
import geemap

# GEE ချိတ်ဆက်ခြင်း
ee.Initialize(project='urban-heat-island-yangon')

# ရန်ကုန်မြို့ ဧရိယာသတ်မှတ်ခြင်း
yangon_geom = ee.Geometry.Polygon([
    [[96.0, 16.7], [96.3, 16.7], [96.3, 17.0], [96.0, 17.0]]
])

# Landsat 8/9 ဒေတာကို ခေါ်ယူခြင်း
collection = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
              .filterBounds(yangon_geom)
              .filterDate('2024-01-01', '2024-12-31')
              .sort('CLOUD_COVER')
              .first())

# NDVI တွက်ချက်ခြင်း (NIR (B5) နှင့် Red (B4) ကို အသုံးပြုခြင်း)
ndvi = collection.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI')

# မြေပုံပေါ်တွင် ဖော်ပြရန်
Map = geemap.Map(center=[16.8409, 96.1735], zoom=11)

# NDVI အရောင်သတ်မှတ်ချက် (အပင်စိမ်းေသာနေရာ အစိမ်းရောင်၊ မြေလွတ်/အဆောက်အအုံ ညိုပြာ/အဝါရောင်)
ndvi_viz = {
    'min': 0.0,
    'max': 0.8,
    'palette': ['blue', 'white', 'green']
}

Map.addLayer(ndvi.clip(yangon_geom), ndvi_viz, 'Yangon NDVI (Green Cover)')
Map.addLayerControl()

# HTML ဖိုင်အဖြစ် ထုတ်ယူခြင်း
Map.to_html('yangon_ndvi_map.html')
print("NDVI map generated successfully! Open 'yangon_ndvi_map.html' in your browser.")