# Todo App - Model Definitions
# Showcases: enum, validations, scopes, callbacks, associations

class Category < Homura::Model
  table :categories
  column :id, :integer
  column :name, :string
  column :color, :string
  column :created_at, :string

  validates :name, presence: true
  validates :name, length: { minimum: 1, maximum: 50 }

  has_many :todos

  before_save :strip_name

  def strip_name
    @attributes[:name] = @attributes[:name].to_s.strip if @attributes[:name]
  end
end

class Todo < Homura::Model
  table :todos
  column :id, :integer
  column :title, :string
  column :description, :string
  column :status, :integer
  column :priority, :integer
  column :due_date, :string
  column :category_id, :integer
  column :created_at, :string
  column :updated_at, :string

  validates :title, presence: true
  validates :title, length: { minimum: 1, maximum: 100 }

  belongs_to :category

  enum :status, [:pending, :in_progress, :done]

  scope :pending, -> { where(status: 0) }
  scope :in_progress, -> { where(status: 1) }
  scope :done, -> { where(status: 2) }
  scope :high_priority, -> { where(priority: 3) }
  scope :by_category, ->(cat_id) { where(category_id: cat_id) }

  before_save :update_timestamp
  before_save :set_default_priority

  def update_timestamp
    @attributes[:updated_at] = Time.now.to_i.to_s
  end

  def set_default_priority
    @attributes[:priority] = 2 unless @attributes[:priority] && @attributes[:priority].to_i > 0
  end
end
