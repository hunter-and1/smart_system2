# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (c) 2013-Present Acespritech Solutions Pvt. Ltd. (<http://acespritech.com>).
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU Affero General Public License as
#    published by the Free Software Foundation, either version 3 of the
#    License, or (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU Affero General Public License for more details.
#
#    You should have received a copy of the GNU Affero General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################

from odoo import models, fields, api, tools, _


class PrintProfitMargin(models.TransientModel):
    _name = "wizard.profit.margin"

    partner_id = fields.Many2one('res.partner', 'Customer')
    start_date = fields.Date('Start Date')
    end_date = fields.Date('end Date')

    def print_profit_margin(self):
        data = self.read()[0]
        datas = {
            'ids': self._ids,
            'model': 'wizard.profit.margin',
            'form': data,
        }
        return self.env['report']\
            .get_action(self, 'smart_system2.report_profit_margin_template', data=datas)

    def get_order_by_customer(self, cust_id=False, start_date=False, end_date=False):
        pos_order = self.env['pos.order']
        fields = ['name', 'pos_reference','date_order', 'total_margin', 'amount_total']
        domain = []
        if cust_id:
            domain.append(('partner_id', '=', cust_id))
        if start_date:
            domain.append(('date_order', '>=', start_date))
        if end_date:
            domain.append(('date_order', '<=', end_date))
        order_obj = pos_order.search_read(domain=domain,
                fields=fields)
        if order_obj:
            return order_obj
        return False

    def calculate_total_margin(self, orders):
        if orders:
            grand_total_margin = 0.00
            for order in orders:
                grand_total_margin += order.get('total_margin')
            return grand_total_margin
        return False

class smart_system2_report_profit_margin_template(models.AbstractModel):
    _name = "report.smart_system2.report_profit_margin_template"

    @api.model
    def render_html(self, docids, data=None):

        report_obj = self.env['report']
        report = report_obj._get_report_from_name('smart_system2.report_profit_margin_template')
        docargs = {
            'doc_ids': self.env["wizard.profit.margin"].search([('id', 'in', list(data["ids"]))]),
            'doc_model': report.model,
            'data': data,
            'docs': self,
        }
        return self.env['report'].render('smart_system2.report_profit_margin_template', docargs)
# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4: