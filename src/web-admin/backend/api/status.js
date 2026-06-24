import { getConfig } from './lib/storage.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const config = await getConfig();
    return res.status(200).json({
      maintenanceMode: Boolean(config.maintenanceMode),
      maintenanceBanner: config.maintenanceBanner || '',
      proPriceVnd: config.proPriceVnd,
    });
  } catch {
    return res.status(200).json({
      maintenanceMode: false,
      maintenanceBanner: '',
      proPriceVnd: parseInt(process.env.PRO_PRICE_VND || '299000', 10),
    });
  }
}

