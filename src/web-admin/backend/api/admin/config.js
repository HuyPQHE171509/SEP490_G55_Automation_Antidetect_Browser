/**
 * GET  /api/admin/config  — read config
 * POST /api/admin/config  — update config (persists to .data/config.json)
 */
import { getConfig, saveConfig } from '../lib/storage.js';


export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(await getConfig());
  }

  if (req.method === 'POST') {
    const { proPriceVnd, maintenanceMode, maintenanceBanner, downloadUrls, appVersion } = req.body || {};
    const current = await getConfig();
    const updated = {
      ...current,
      ...(proPriceVnd !== undefined && { proPriceVnd: Math.max(1000, parseInt(proPriceVnd, 10)) }),
      ...(maintenanceMode !== undefined && { maintenanceMode: Boolean(maintenanceMode) }),
      ...(maintenanceBanner !== undefined && { maintenanceBanner: String(maintenanceBanner).slice(0, 200) }),
      ...(downloadUrls !== undefined && { downloadUrls: downloadUrls }),
      ...(appVersion !== undefined && { appVersion: String(appVersion).slice(0, 20) }),
      updatedAt: new Date().toISOString(),
      updatedBy: req.adminEmail,
    };
    await saveConfig(updated);
    console.log(`[admin/config] updated by ${req.adminEmail}`, updated);
    return res.status(200).json(updated);
  }

  return res.status(405).end();
}
