# DSL-Driven API Builder - Model Definitions
# These are loaded together with homura_model.rb in a single eval to avoid
# WASM longjmp function table corruption between separate eval calls.

class Author < Homura::Model
  table :authors
  column :id, :integer
  column :name, :string
  column :email, :string
  column :created_at, :string

  validates :name, presence: true
  validates :name, length: { minimum: 2, maximum: 100 }
  validates :email, format: { pattern: :email }

  has_many :articles
  has_one :profile
end

class Profile < Homura::Model
  table :profiles
  column :id, :integer
  column :author_id, :integer
  column :bio, :string
  column :website, :string
  column :created_at, :string

  belongs_to :author

  validates :author_id, presence: true
end

class Article < Homura::Model
  table :articles
  column :id, :integer
  column :title, :string
  column :slug, :string
  column :body, :string
  column :author_id, :integer
  column :status, :integer
  column :view_count, :integer
  column :created_at, :string
  column :updated_at, :string

  validates :title, presence: true
  validates :title, length: { minimum: 3, maximum: 200 }
  validates :body, presence: true

  belongs_to :author

  enum :status, [:draft, :published, :archived]

  scope :published, -> { where(status: 1) }
  scope :drafts, -> { where(status: 0) }
  scope :by_author, ->(author_id) { where(author_id: author_id) }

  before_save :generate_slug
  before_save :update_timestamp

  def generate_slug
    return unless @attributes[:title]
    return if @attributes[:slug] && @attributes[:slug].to_s.length > 0
    @attributes[:slug] = @attributes[:title].to_s.downcase.tr(" ", "-")
  end

  def update_timestamp
    @attributes[:updated_at] = Time.now.to_i.to_s
  end
end

class Tag < Homura::Model
  table :tags
  column :id, :integer
  column :name, :string
  column :created_at, :string

  validates :name, presence: true
  validates :name, length: { minimum: 1, maximum: 50 }
end
