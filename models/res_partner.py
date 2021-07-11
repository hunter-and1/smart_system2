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

from openerp import models, fields, api, _
import odoo.addons.decimal_precision as dp
from odoo.exceptions import UserError


class ResPartner(models.Model):
    _inherit = 'res.partner'

    def _compute_debt(self):
        domain = [('partner_id', 'in', self.ids)]
        fields = ['partner_id', 'balance']
        res = self.env['report.pos.debt'].read_group(
            domain,
            fields,
            'partner_id')
        res_index = dict((id, {'balance': 0}) for id in self.ids)
        for data in res:
            res_index[data['partner_id'][0]] = data

        for r in self:
            r.debt = -res_index[r.id]['balance']
            r.credit_balance = -r.debt

    @api.model
    def _default_debt_limit(self):
        debt_limit = self.env["ir.config_parameter"].get_param("smart_system2.debt_limit", default=0)
        return float(debt_limit)

    def debt_history(self, limit=0, start_date=False, end_date=False):
        """
        Get debt details

        :param int limit: max number of records to return
        :return: dictonary with keys:
             * debt: current debt
             * records_count: total count of records
             * history: list of dictionaries

                 * date
                 * config_id
                 * balance

        """
        res = []
        fields = [
            'date',
            'config_id',
            'order_id',
            'invoice_id',
            'balance',
        ]
        for r in self:
            domain = [('partner_id', '=', r.id)]
            if start_date and end_date:
                domain.append(('order_id.date_order', '>=', start_date))
                domain.append(('order_id.date_order', '<=', end_date))
            elif start_date and not end_date:
                domain.append(('order_id.date_order', '>=', start_date))
            data = {"debt": r.debt}
            if limit:
                records = self.env['report.pos.debt'].search_read(
                    domain=domain,
                    fields=fields,
                    limit=limit,
                )
                data['history'] = records
            else:
                records = self.env['report.pos.debt'].search_read(
                    domain=domain,
                    fields=fields,
                )
                data['history'] = records
            data['records_count'] = self.env['report.pos.debt'].search_count(domain)
            data['partner_id'] = r.id
            res.append(data)
        debt_type =  self.debt_type
        if debt_type == 'credit':
            sign = -1
        else:
            sign = 1
        total_balance = self.debt
        for result in res:
            for history in result.get('history'):
                history['total_bal'] = (sign * round(total_balance * 100, 2)) / 100
                total_balance += history.get('balance')
        return res

    debt = fields.Float(
        compute='_compute_debt', string='Debt', readonly=True,
        digits=dp.get_precision('Account'), help='This debt value for only current company')
    credit_balance = fields.Float(
        compute='_compute_debt', string='Credit', readonly=True,
        digits=dp.get_precision('Account'), help='This credit balance value for only current company')
    debt_type = fields.Selection(compute='_compute_debt_type', selection=[
        ('debt', 'Display Debt'),
        ('credit', 'Display Credit')
    ])
    debt_limit = fields.Float(
        string='Max Debt', digits=dp.get_precision('Account'), default=_default_debt_limit,
        help='The customer is not allowed to have a debt more than this value')

    def _compute_debt_type(self):
        debt_type = self.env["ir.config_parameter"].get_param("smart_system2.debt_type", default='debt')
        for partner in self:
            partner.debt_type = debt_type

    def check_access_to_debt_limit(self, vals):
        debt_limit = vals.get('debt_limit')
        if ('debt_limit' in vals and self._default_debt_limit() != debt_limit and
                not self.env.user.has_group('point_of_sale.group_pos_manager')):
            raise UserError('Only POS managers can change a debt limit value!')

    def get_order_by_id(self, id):
        order_obj = self.env['pos.order'].browse(id)
        if order_obj:
            return order_obj
        return False


    @api.model
    def create(self, vals):
        self.check_access_to_debt_limit(vals)
        return super(ResPartner, self).create(vals)

    def write(self, vals):
        self.check_access_to_debt_limit(vals)
        return super(ResPartner, self).write(vals)

    @api.model
    def create_from_ui(self, partner):
        if partner.get('debt_limit') is False:
            del partner['debt_limit']
        return super(ResPartner, self).create_from_ui(partner)

# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4: