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

import logging
from odoo import models, fields, api, tools, _
from odoo.exceptions import UserError
import odoo.addons.decimal_precision as dp
from datetime import datetime, timedelta
from odoo.tools import float_is_zero
import pytz
import time
import psycopg2
from pytz import timezone
_logger = logging.getLogger(__name__)
import dateutil

class PosConfig(models.Model):
    _inherit = 'pos.config'

    enable_pricelist = fields.Boolean('Enable Price List')
    enable_add_product = fields.Boolean('Enable Add Product')
    enable_order_note = fields.Boolean('Enable Order Note')
    enable_product_note = fields.Boolean('Enable Product / Line Note')
    enable_show_qty_on_pos = fields.Boolean('Enable Display Stock In Pos')
    enable_show_cost_price = fields.Boolean('Enable Show Cost Price')
    enable_margin = fields.Boolean('Enable Show Margin')
    enable_cart_detail = fields.Boolean('Enable Cart Detail')
    enable_multi_sale_location = fields.Boolean('Enable Multi Sale Location')
    enable_debit = fields.Boolean('Enable Debit')
    last_days = fields.Char("Last Days")
    record_per_page = fields.Integer("Record Per Page")
    paid_amount_product = fields.Many2one('product.product', string='Paid Amount Product', domain=[('available_in_pos', '=', True)])
    enable_order_list = fields.Boolean('Enable Order List')
    enable_product_sync = fields.Boolean('Enable Product Sync')

    debt_dummy_product_id = fields.Many2one(
        'product.product',
        string='Dummy Product for Debt',
        domain=[('available_in_pos', '=', True)],
        help="Dummy product used when a customer pays his debt "
        "without ordering new products. This is a workaround to the fact "
        "that Odoo needs to have at least one product on the order to "
        "validate the transaction.")

    def init_debt_journal(self):
        journal_obj = self.env['account.journal']
        user = self.env.user
        debt_journal_active = journal_obj.search([
            ('code', '=', 'TDEBT'),
            ('name', '=', 'Debt Journal'),
            ('company_id', '=', user.company_id.id),
            ('debt', '=', True),
        ])
        if debt_journal_active:
            #  Check if the debt journal is created already for the company.
            return

        account_obj = self.env['account.account']
        debt_account_old_version = account_obj.search([
            ('code', '=', 'XDEBT'), ('company_id', '=', user.company_id.id)])
        if debt_account_old_version:
            debt_account = debt_account_old_version[0]
        else:
            debt_account = account_obj.create({
                'name': 'Debt',
                'code': 'XDEBT',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "XDEBT" should not be modified as it is used to compute debt',
            })
            self.env['ir.model.data'].create({
                'name': 'debt_account_for_company' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'smart_system2',
                'res_id': debt_account.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        debt_journal_inactive = journal_obj.search([
            ('code', '=', 'TDEBT'),
            ('name', '=', 'Debt Journal'),
            ('company_id', '=', user.company_id.id),
            ('debt', '=', False),
        ])
        if debt_journal_inactive:
            debt_journal_inactive.write({
                'debt': True,
                'default_debit_account_id': debt_account.id,
                'default_credit_account_id': debt_account.id,
            })
            debt_journal = debt_journal_inactive
        else:
            new_sequence = self.env['ir.sequence'].create({
                'name': 'Account Default Debt Journal ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'DEBT ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'smart_system2',
                'res_id': new_sequence.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })
            debt_journal = journal_obj.create({
                'name': 'Debt Journal',
                'code': 'TDEBT',
                'type': 'cash',
                'debt': True,
                # 'journal_user': True,
                'sequence': new_sequence.id,
                'company_id': user.company_id.id,
                'payment_debit_account_id': debt_account.id,
                'payment_credit_account_id': debt_account.id,
            })
            self.env['ir.model.data'].create({
                'name': 'debt_journal_' + str(debt_journal.id),
                'model': 'account.journal',
                'module': 'smart_system2',
                'res_id': int(debt_journal.id),
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        config = self
        config.write({
            'journal_id': debt_journal.id,
            'debt_dummy_product_id': self.env.ref('smart_system2.product_pay_debt').id,
        })

        statement = [(0, 0, {
            'journal_id': debt_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.write({
            'statement_ids': statement,
        })
        return

    def open_session_cb(self):
        res = super(PosConfig, self).open_session_cb()
        self.init_debt_journal()
        return res


class Product(models.Model):

    _inherit = 'product.template'

    credit_product = fields.Boolean('Credit Product', default=False, help="This product is used to buy Credits (pay for debts).")


class pos_order(models.Model):
    _inherit = "pos.order"
    
    total_margin = fields.Float('Total Margin')

    @api.model
    def _process_order(self,order):
        pos_line_obj = self.env['pos.order.line']
        draft_order_id = order.get('old_order_id')
        if order.get('draft_order'):
            if not draft_order_id:
                order.pop('draft_order')
                order_id = self.with_context({ 'from_pos':True }).create(self._order_fields(order))
                return order_id
            else:
                order_id = draft_order_id
                pos_line_ids = pos_line_obj.search([('order_id', '=', order_id)])
                if pos_line_ids:
                    pos_line_obj.unlink(pos_line_ids)
                self.write([order_id],
                           {'lines': order['lines'],
                            'partner_id': order.get('partner_id')})
                return order_id

        if not order.get('draft_order') and draft_order_id:
            order_id = draft_order_id
            order_obj = self.browse(order_id)
            session = self.env['pos.session'].browse(order['pos_session_id'])
            pos_line_ids = pos_line_obj.search([('order_id', '=', order_id)])
            if pos_line_ids:
#                 pos_line_obj.unlink(pos_line_ids)
                for line_id in pos_line_ids:
                    line_id.unlink()
            temp = order.copy()
            temp.pop('statement_ids', None)
            temp.pop('name', None)
            temp.update({
                'date_order': order.get('creation_date')
            })
            if temp.get('lines'):
                lines = temp.get('lines')
                for line in lines:
                    if line[2].has_key('paid_line') and line[2].get('paid_line'):
                        temp.get('lines').remove(line)

            order_obj.write(temp)
            statement_line_ids = self.env['account.bank.statement.line'].\
                search([('pos_statement_id', '=', order_id)])
            if statement_line_ids:
                for statement_line_id in statement_line_ids:
                    statement_line_id.unlink()
            for payments in order['statement_ids']:
                if payments[2]:
                    order_obj.with_context({'from_pos':True}).add_payment(self._payment_fields(payments[2]))


            if session.sequence_number <= order['sequence_number']:
                session.write({'sequence_number': order['sequence_number'] + 1})
                session.refresh()

            if not float_is_zero(order['amount_return'], self.env['decimal.precision'].precision_get('Account')):
                cash_journal = session.cash_journal_id
                if not cash_journal:
                    cash_journal_ids = filter(lambda st: st.journal_id.type == 'cash' and not st.journal_id.debt, session.statement_ids)
                    if not len(cash_journal_ids):
                        raise Warning(_('error!'),
                                             _("No cash statement found for this session. Unable to record returned cash."))
                    cash_journal = cash_journal_ids[0].journal_id
                order_obj.add_payment({
                    'amount': -order['amount_return'],
                    'payment_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'payment_name': _('return'),
                    'journal': cash_journal.id,
                })
            return order_obj

        if not order.get('draft_order') and not draft_order_id:
            context = {'from_pos':True}

            if order.get('amount_return'):
                context.update({ 'is_change': True })
            pos_order = order
            prec_acc = self.env['decimal.precision'].precision_get('Account')
            pos_session = self.env['pos.session'].browse(pos_order['pos_session_id'])
            if pos_session.state == 'closing_control' or pos_session.state == 'closed':
                pos_order['pos_session_id'] = self._get_valid_session(pos_order).id
            order = self.create(self._order_fields(pos_order))
            journal_ids = set()
            for payments in pos_order['statement_ids']:
                if not float_is_zero(payments[2]['amount'], precision_digits=prec_acc):
                    order.add_payment(self._payment_fields(order,payments[2]))
                print('\n\n=======',payments[2])
                journal_ids.add(payments[2].get('journal_id'))

            if pos_session.sequence_number <= pos_order['sequence_number']:
                pos_session.write({'sequence_number': pos_order['sequence_number'] + 1})
                pos_session.refresh()

            if not float_is_zero(pos_order['amount_return'], prec_acc):
                cash_journal_id = pos_session.cash_journal_id.id
                if not cash_journal_id:
                    # Select for change one of the cash journals used in this
                    # payment
                    cash_journal = self.env['account.journal'].search([
                        ('type', '=', 'cash'),
                        ('id', 'in', list(journal_ids)),
                    ], limit=1)
                    if not cash_journal:
                        # If none, select for change one of the cash journals of the POS
                        # This is used for example when a customer pays by credit card
                        # an amount higher than total amount of the order and gets cash back
                        cash_journal = [statement.journal_id for statement in pos_session.statement_ids if statement.journal_id.type == 'cash']
                        if not cash_journal:
                            raise UserError(_("No cash statement found for this session. Unable to record returned cash."))
                    cash_journal_id = cash_journal[0].id
                order.with_context({'is_change': True}).add_payment({
                    'amount': -pos_order['amount_return'],
                    'payment_date': fields.Datetime.now(),
                    'payment_name': _('return'),
                    'journal': cash_journal_id,
                })
            return order

    def _order_fields(self,ui_order):
        res = super(pos_order, self)._order_fields(ui_order)
        res.update({
            'note': ui_order.get('order_note') or False,
            'total_margin':ui_order.get('total_margin') or False
        })
        return res

    @api.model
    def add_payment(self, data):
        """Create a new payment for the order"""
        if data['amount'] == 0.0:
            return
        super(pos_order, self).add_payment(data)

    @api.model
    def ac_pos_search_read(self, domain):
        search_vals = self.search_read(domain)
        user_id = self.env['res.users'].browse(self._uid)
        tz = False
        if self._context and self._context.get('tz'):
            tz = timezone(self._context.get('tz'))
        elif user_id and user_id.tz:
            tz = timezone(user_id.tz)
        if tz:
            c_time = datetime.now(tz)
            hour_tz = int(str(c_time)[-5:][:2])
            min_tz = int(str(c_time)[-5:][3:])
            sign = str(c_time)[-6][:1]
            today_sale = 0.0
            result = []
            for val in search_vals:
                if sign == '-':
                    val.update({
                        'date_order':(datetime.strptime(val.get('date_order'), '%Y-%m-%d %H:%M:%S') - timedelta(hours=hour_tz, minutes=min_tz)).strftime('%Y-%m-%d %H:%M:%S')
                    })
                elif sign == '+':
                    val.update({
                        'date_order':(datetime.strptime(val.get('date_order'), '%Y-%m-%d %H:%M:%S') + timedelta(hours=hour_tz, minutes=min_tz)).strftime('%Y-%m-%d %H:%M:%S')
                    })
                result.append(val)
            return result
        else:
            return search_vals

    @api.model
    def make_it_paid(self, orders):
        for order in orders:
            order_obj = self.browse(order.get('order_id'))
            if order_obj:
                existing_statement_line = self.env['account.bank.statement.line'].browse(order.get('statement_id'))
                if existing_statement_line:
                    payment = {
                        'statement_id': existing_statement_line.statement_id.id,
                        'journal_id': existing_statement_line.journal_id.id,
                        'account_id': existing_statement_line.account_id.id,
                        'amount': order.get('amount_total'),
                        'name': order.get('name'),
                    }
                    order_obj.add_payment(self._payment_fields(payment))
                    try:
                        order_obj.action_pos_order_paid()
                    except psycopg2.OperationalError:
                        # do not hide transactional errors, the order(s) won't be saved!
                        raise
                    except Exception as e:
                        _logger.error('Could not fully process the POS Order: %s', tools.ustr(e))

    @api.model
    def create_from_ui(self, orders, draft=False):
        # Keep only new orders
        submitted_references = [o['data']['name'] for o in orders]
        pos_order = self.search([('pos_reference', 'in', submitted_references)])
        existing_orders = pos_order.read(['pos_reference'])
        existing_references = set([o['pos_reference'] for o in existing_orders])
        orders_to_save = [o for o in orders if o['data']['name'] not in existing_references]
        order_ids = []

        for tmp_order in orders_to_save:
            to_invoice = tmp_order['to_invoice']
            order = tmp_order['data']
            if to_invoice:
                self._match_payment_to_invoice(order)
            pos_order = self._process_order(order)
            order_ids.append(pos_order.id)

            try:
                if order and not order.get('set_as_draft'):
                    pos_order.action_pos_order_paid()
            except psycopg2.OperationalError:
                # do not hide transactional errors, the order(s) won't be saved!
                raise
            except Exception as e:
                _logger.error('Could not fully process the POS Order: %s', tools.ustr(e))

            if to_invoice:
                pos_order.action_pos_order_invoice()
                pos_order.invoice_id.sudo().action_invoice_open()
                pos_order.account_move = pos_order.invoice_id.move_id
        return order_ids


class pos_order_line(models.Model):
    _inherit = 'pos.order.line'

    line_note = fields.Char('Comment', size=512)
    line_margin = fields.Float('Margin')
    line_stock_location = fields.Many2one('stock.location')

class AccountJournal(models.Model):
    _inherit = 'account.journal'

    debt = fields.Boolean(string='Debt Payment Method')


class PosConfiguration(models.TransientModel):
    _inherit = 'res.config.settings'

    debt_type = fields.Selection([
        ('debt', 'Display Debt'),
        ('credit', 'Display Credit')
    ], default='debt', string='Debt Type', help='Way to display debt value (label and sign of the amount). '
                                                'In both cases debt will be red, credit - green')
    debt_limit = fields.Float(
        string='Default Max Debt', digits=dp.get_precision('Account'), default=0,
        help='Default value for new Customers')

    @api.model
    def get_values(self):
        res = super(PosConfiguration, self).get_values()

        res['debt_type'] = self.env['ir.config_parameter'].sudo().get_param('smart_system2.debt_type')
        res['debt_limit'] = float(
            self.env['ir.config_parameter'].sudo().get_param('smart_system2.debt_limit', default=0.0))
        return res

    @api.model
    def set_values(self):
        self.env['ir.config_parameter'].sudo().set_param('smart_system2.debt_type', self.debt_type)
        self.env['ir.config_parameter'].sudo().set_param('smart_system2.debt_limit', self.debt_limit)
        super(PosConfiguration, self).set_values()


class GroupByExtra(models.AbstractModel):
    _name = "base_groupby_extra"

    @api.model
    def _read_group_process_groupby(self, gb, query):
        split = gb.split(':')
        field_type = self._fields[split[0]].type
        gb_function = split[1] if len(split) == 2 else None
        temporal = field_type in ('date', 'datetime')
        tz_convert = field_type == 'datetime' and self._context.get('tz') in pytz.all_timezones
        qualified_field = self._inherits_join_calc(self._table, split[0], query)

        if temporal and gb_function in ['hour']:
            # BEGIN New stuff
            display_formats = {
                'hour': 'hh:00 dd MMM',
            }
            time_intervals = {
                'hour': dateutil.relativedelta.relativedelta(hours=1),
            }
            # END New stuff
            if tz_convert:
                qualified_field = "timezone('%s', timezone('UTC',%s))" % (self._context.get('tz', 'UTC'), qualified_field)
            qualified_field = "date_trunc('%s', %s)" % (gb_function or 'month', qualified_field)
            res = {
                'field': split[0],
                'groupby': gb,
                'type': field_type,
                'display_format': display_formats[gb_function or 'month'] if temporal else None,
                'interval': time_intervals[gb_function or 'month'] if temporal else None,
                'tz_convert': tz_convert,
                'qualified_field': qualified_field
            }
        else:
            res = super(GroupByExtra, self)._read_group_process_groupby(gb, query)
        return res

    
class res_users(models.Model):
    _inherit="res.users"

    default_pos = fields.Many2one('pos.config', 'Default POS', domain=[('active', '=', True)])


class product_product(models.Model):
    _inherit = 'product.product'

    @api.depends('stock_quant_ids', 'stock_move_ids')
    def _compute_quantities(self):
        res = self._compute_quantities_dict(self._context.get('lot_id'), self._context.get('owner_id'), self._context.get('package_id'), self._context.get('from_date'), self._context.get('to_date'))
        for product in self:
            product.qty_available = res[product.id]['qty_available']
            product.incoming_qty = res[product.id]['incoming_qty']
            product.outgoing_qty = res[product.id]['outgoing_qty']
            product.virtual_available = res[product.id]['virtual_available']
            if product.temp_qty_available != product.qty_available:
                product.write({'temp_qty_available': product.qty_available})

    def _search_qty_available(self, operator, value):
        # TDE FIXME: should probably clean the search methods
        if value == 0.0 and operator in ('=', '>=', '<='):
            return self._search_product_quantity(operator, value, 'qty_available')
        product_ids = self._search_qty_available_new(operator, value, self._context.get('lot_id'), self._context.get('owner_id'), self._context.get('package_id'))
        return [('id', 'in', product_ids)]

    qty_available = fields.Float(
        'Quantity On Hand', compute='_compute_quantities', search='_search_qty_available',
        digits=dp.get_precision('Product Unit of Measure'),
        help="Current quantity of products.\n"
             "In a context with a single Stock Location, this includes "
             "goods stored at this Location, or any of its children.\n"
             "In a context with a single Warehouse, this includes "
             "goods stored in the Stock Location of this Warehouse, or any "
             "of its children.\n"
             "stored in the Stock Location of the Warehouse of this Shop, "
             "or any of its children.\n"
             "Otherwise, this includes goods stored in any Stock Location "
             "with 'internal' type.")

    temp_qty_available = fields.Float(string="QTY AVAIL", readonly=True)


    @api.model
    def get_last_updated_product(self, fields, write_date):
        # After search record will be update its qty available
        product_ids = self.search([('sale_ok','=', True), ('available_in_pos','=',True),
                    ('write_date', '>', write_date)])
        ids = [i.id for i in product_ids]
        # search read returns dictionary with fields.
        products = self.search_read( [('id', 'in', ids)], fields )
        return products

class wrapped_report_pos_receipt(models.AbstractModel):
    _name = 'report.smart_system2.pos_receipt_report_template'

    @api.model
    def render_html(self, docids, data=None):
       report_obj = self.env['report']
       report = report_obj._get_report_from_name('smart_system2.pos_receipt_report_template')
       docargs = {
           'doc_ids': self.env['pos.order'].browse(docids),
           'doc_model': report.model,
           'docs': self,
           'get_journal_amt': self._get_journal_amt,
       }
       return report_obj.render('smart_system2.pos_receipt_report_template', docargs)

    def _get_journal_amt(self, order_id):
        data={}
        sql = """ select aj.name,absl.amount as amt from account_bank_statement as abs
                        LEFT JOIN account_bank_statement_line as absl ON abs.id = absl.statement_id
                        LEFT JOIN account_journal as aj ON aj.id = abs.journal_id
                        WHERE absl.pos_statement_id =%d"""%(order_id)
        self._cr.execute(sql)
        data = self._cr.dictfetchall()
        return data

class AccountBankStatementLine(models.Model):
    _inherit = "account.bank.statement.line"

    is_change = fields.Boolean("Is Change")

    @api.constrains('amount')
    def _check_amount(self):
        if not self._context.get('from_pos'):
            super(AccountBankStatementLine, self)._check_amount()

    @api.constrains('amount', 'amount_currency')
    def _check_amount_currency(self):
        if not self._context.get('from_pos'):
            super(AccountBankStatementLine, self)._check_amount_currency()

    @api.model
    def create(self, vals):
        if self._context.get('is_change'):
            vals.update({'is_change': True})
        return super(AccountBankStatementLine, self).create(vals)

# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4:
