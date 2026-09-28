import { Router } from 'express';
import { requireAdmin } from '../../lib/auth.js';
import { authRouter } from './auth.js';
import { catalogRouter } from './catalog.js';
import { inventoryRouter } from './inventory.js';
import { ordersRouter, paymentsRouter } from './orders.js';
import { returnsRouter } from './returns.js';
import { discountsRouter } from './discounts.js';
import { reportsRouter } from './reports.js';
import { notificationsRouter } from './notifications.js';
import { settingsRouter, reviewsRouter } from './settings.js';

export const adminRouter = Router();

// Login is public; everything else requires an admin session.
adminRouter.use('/auth', authRouter);
adminRouter.use(requireAdmin);

// catalogRouter defines /categories and /products.
adminRouter.use('/', catalogRouter);
adminRouter.use('/inventory', inventoryRouter);
adminRouter.use('/orders', ordersRouter);
adminRouter.use('/payments', paymentsRouter);
adminRouter.use('/cancellations-returns', returnsRouter);
adminRouter.use('/discounts', discountsRouter);
adminRouter.use('/reports', reportsRouter);
adminRouter.use('/notifications', notificationsRouter);
adminRouter.use('/settings', settingsRouter);
adminRouter.use('/reviews', reviewsRouter);
